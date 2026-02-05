from youtube_transcript_api import (
    YouTubeTranscriptApi,
    TranscriptsDisabled,
    NoTranscriptFound,
)
from langchain_core.prompts import PromptTemplate
from langchain_ollama import OllamaEmbeddings, ChatOllama
from test2 import open_router_model
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_huggingface import HuggingFaceEndpoint, ChatHuggingFace
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_community.vectorstores import Chroma
from langchain_classic.retrievers.self_query.base import SelfQueryRetriever
from langchain_classic.chains.query_constructor.base import (
    AttributeInfo,
    load_query_constructor_runnable,
)
from langchain_community.query_constructors.chroma import ChromaTranslator
from langchain_core.output_parsers import StrOutputParser, PydanticOutputParser
from dotenv import load_dotenv
import re
import math
import sys
import time
import unicodedata
from typing import Literal, List
from pydantic import BaseModel, Field
from langchain_community.chat_message_histories import ChatMessageHistory

# Load Env
load_dotenv()

# Models
model_ep = HuggingFaceEndpoint(repo_id="XiaomiMiMo/MiMo-V2-Flash", temperature=0.5)
model_hf = ChatHuggingFace(llm=model_ep)
model_ollama = ChatOllama(model="llama3.2:3b", temperature=0.5)
model_google = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.4)


class SafeOllamaEmbeddings(OllamaEmbeddings):
    """
    Wrapper around OllamaEmbeddings that sanitizes any NaN/Inf in embedding vectors
    and retries a couple times on transient failures.
    """

    def _sanitize_vector(self, vec):
        sanitized = []

        def _flatten(x):
            if isinstance(x, (list, tuple)):
                for el in x:
                    yield from _flatten(el)
            else:
                yield x

        for v in _flatten(vec):
            try:
                fv = float(v)
                if not math.isfinite(fv):
                    sanitized.append(0.0)
                else:
                    sanitized.append(fv)
            except Exception:
                sanitized.append(0.0)
        return sanitized

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        raw = super().embed_documents(texts)
        return [self._sanitize_vector(v) for v in raw]

    def embed_query(self, text: str) -> List[float]:
        # retry once on transient errors
        last_exception = None
        for attempt in range(2):
            try:
                raw = super().embed_query(text)
                return self._sanitize_vector(raw)
            except Exception as e:
                last_exception = e
                time.sleep(0.2 * (attempt + 1))

        # Instead of returning [0.0], we raise so validate_chunks can skip this chunk
        if last_exception:
            raise last_exception
        return []


def validate_chunks_for_embeddings(
    chunks: List[Document], embeddings_instance
) -> List[Document]:
    validated_chunks: List[Document] = []

    for chunk in chunks:
        content = (chunk.page_content or "").strip()
        if not content:
            continue

        # remove control characters only (unicode category C)
        content = "".join(ch for ch in content if unicodedata.category(ch)[0] != "C")
        content = " ".join(content.split())
        if len(content) < 15:
            continue

        # canonical normalize (NFKC)
        content = unicodedata.normalize("NFKC", content)

        # attempt embedding with small retry
        success = False
        for attempt in range(2):
            try:
                vec = embeddings_instance.embed_query(content)
                # flatten and check numeric values
                flat = []

                def _flatten(x):
                    if isinstance(x, (list, tuple)):
                        for el in x:
                            _flatten(el)
                    else:
                        flat.append(float(x))

                _flatten(vec)
                if not flat or len(flat) < 100:  # Sanity check for embedding length
                    raise ValueError("invalid embedding length")
                if not flat:
                    raise ValueError("empty embedding")
                if any(not math.isfinite(v) for v in flat):
                    raise ValueError("embedding contains NaN/Inf")
                success = True
                break
            except Exception:
                time.sleep(0.15 * (attempt + 1))

        if success:
            validated_chunks.append(
                Document(page_content=content, metadata=chunk.metadata)
            )
        else:
            if validated_chunks:
                prev = validated_chunks[-1]
                merged = prev.page_content + " " + content
                validated_chunks[-1] = Document(
                    page_content=merged, metadata=prev.metadata
                )
            else:
                continue

    return validated_chunks


# Helper Functions
SUPPORTED_LANGS = [
    "en",
    "hi",
    "es",
    "fr",
    "de",
    "zh-Hans",
    "zh-Hant",
    "ja",
    "ko",
    "ru",
    "pt",
    "it",
    "ar",
    "tr",
    "vi",
]


def extract_video_id(url):
    pattern = r"(?:v=|be/|embed/|/)([0-9A-Za-z_-]{11})"
    match = re.search(pattern, url)
    return match.group(1) if match else url


# Transcript Extraction
user_link = input("Paste YouTube Link (or press Enter for default): ").strip()
if not user_link:
    video_id = "1anzYiOyWTQ"  # Using a known working video as default
else:
    video_id = extract_video_id(user_link)

print(f"Processing Video ID: {video_id}")

api = YouTubeTranscriptApi()
transcript_list = []
try:
    transcript_list = api.fetch(video_id, languages=SUPPORTED_LANGS)
except TranscriptsDisabled:
    print("No captions available for this video.")
except NoTranscriptFound:
    print("No transcript found for this video.")
except Exception as e:
    print(f"Error fetching transcript: {e}")

if not transcript_list:
    print("Exiting: No transcript available to process.")
    sys.exit()

# Document Ingestion
fragment_docs = []
for fragment in transcript_list:
    fragment_docs.append(
        Document(
            page_content=fragment.text,
            metadata={
                "video_id": video_id,
                "start": int(fragment.start),
                "end": int(fragment.start + fragment.duration),
            },
        )
    )

# Text Splitting
total_chars = sum(len(d.page_content) for d in fragment_docs)
print(f"Total Transcript Length: {total_chars}")

if not fragment_docs:
    chunks = []
else:
    target_size = max(600, min(1200, int(total_chars / 50)))
    overlap = int(target_size * 0.15)

    raw_docs = []
    current_content = []
    current_start = 0
    current_len = 0

    for i, doc in enumerate(fragment_docs):
        if not current_content:
            current_start = doc.metadata.get("start", 0)

        current_content.append(doc.page_content)
        current_len += len(doc.page_content)
        current_end = doc.metadata.get("end", 0)

        if current_len >= target_size or i == len(fragment_docs) - 1:
            timestamp_label = f"[Timestamp: {int(current_start)}s] "

            raw_docs.append(
                Document(
                    page_content=timestamp_label + " ".join(current_content),
                    metadata={
                        "video_id": video_id,
                        "start": int(current_start),
                        "end": int(current_end),
                    },
                )
            )
            current_content = []
            current_len = 0

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=target_size,
        chunk_overlap=overlap,
    )
    chunks = splitter.split_documents(raw_docs)

    num_chunks = len(chunks)
    if num_chunks < 20:
        dynamic_k = min(num_chunks, 5)
    else:
        dynamic_k = max(5, min(10, int(math.log2(num_chunks) * 1.5)))

    print(f"Chunks created: {num_chunks}")
    print(f"Chunk size: {target_size}")
    print(f"Dynamic k: {dynamic_k}")

# Embedding & Vector Store
embeddings = SafeOllamaEmbeddings(model="bge-m3")

print("Validating chunks for embeddings...")
validated_chunks = validate_chunks_for_embeddings(chunks, embeddings)

if not validated_chunks:
    print("Error: No valid chunks found after validation.")
    sys.exit()

vector_store = Chroma.from_documents(
    validated_chunks, embeddings, collection_name=f"youtube-transcript-{video_id}"
)

try:
    sample_text = " ".join([c.page_content for c in chunks[:10]])
    video_summary_obj = model_ollama.invoke(
        f"Summarize what this video is about in one short sentence based on this text: {sample_text}"
    )
    video_summary = video_summary_obj.content
except Exception:
    video_summary = "this video"

# Retrieval
metadata_field_info = [
    AttributeInfo(
        name="start",
        description="The start time of the video segment in seconds (integer). "
        "Rule 1: If user asks for 'at 12:00', use (start <= 720). "
        "Rule 2: If user asks for 'after 12:00', use (start >= 720). "
        "Rule 3: ALWAYS convert minutes:seconds to total seconds (min * 60 + sec). "
        "Rule 4: Remove time-related keywords (e.g., '12:00', 'minutes', 'seconds') from the semantic search query part.",
        type="integer",
    ),
    AttributeInfo(
        name="end",
        description="The end time of the video segment in seconds (integer). "
        "Rule 1: If user asks for 'at 12:00', use (end >= 720).",
        type="integer",
    ),
    AttributeInfo(
        name="video_id",
        description="The unique YouTube video identifier.",
        type="string",
    ),
]

document_content_description = "Transcript segments from a YouTube video"

query_constructor = load_query_constructor_runnable(
    llm=open_router_model,
    document_contents=document_content_description,
    attribute_info=metadata_field_info,
)

retriever = SelfQueryRetriever(
    query_constructor=query_constructor,
    vectorstore=vector_store,
    structured_query_translator=ChromaTranslator(),
    search_kwargs={"k": dynamic_k},
    verbose=True,
)


def format_docs(retrieved_docs):
    context_entries = []
    for doc in retrieved_docs:
        s = doc.metadata["start"]
        timestamp = f"{s // 60}:{s % 60:02d}"
        context_entries.append(f"[{timestamp}]: {doc.page_content}")
    return "\n\n".join(context_entries)


# Intent Processing
class Router(BaseModel):
    route: Literal["SUMMARY", "RAG"] = Field(
        description="The user's intent: 'SUMMARY' for broad overviews, 'RAG' for specific questions or greetings."
    )


def get_intent(query, history):
    recent_history = "\n".join(
        [f"{m.type}: {m.content}" for m in history.messages[-2:]]
    )

    parser = PydanticOutputParser(pydantic_object=Router)

    router_instruction = """
    You are an expert query router. Based on the conversation history and the new user request, 
    determine if the user wants a broad overview (SUMMARY) or a specific detail/follow-up (RAG).

    CONVERSATION HISTORY:
    {history}

    NEW REQUEST: 
    {query}

    Rules:
    - If the request is a follow-up to a previous specific point or asks for specific details, pick RAG.
    - If the request is a greeting like "hi" or "hello", pick RAG.
    - If the request asks for a general overview of the whole video, pick SUMMARY.

    {format_instructions}
    """

    prompt = PromptTemplate(
        template=router_instruction,
        input_variables=["history", "query"],
        partial_variables={"format_instructions": parser.get_format_instructions()},
    )

    chain = prompt | open_router_model | parser

    try:
        intent_obj = chain.invoke({"history": recent_history, "query": query})
        return intent_obj.route
    except Exception as e:
        print(f"Router parsing error: {e}. Defaulting to RAG.")
        return "RAG"


def get_universal_summary(chunks):
    MAX_CHARS = 500000

    total_text = " ".join([c.page_content for c in chunks])

    if len(total_text) > MAX_CHARS:
        print(f"Video is massive ({len(total_text)} chars). Using Smart Sampling...")
        step = len(total_text) // MAX_CHARS + 1
        sampled_chunks = chunks[::step]
        final_text = " ".join([c.page_content for c in sampled_chunks])
    else:
        print("Video is standard size. Using full transcript...")
        final_text = total_text

    res = open_router_model.invoke(f"""
        Summarize this YouTube video professionally. 
        Provide a concise 4-5 sentence overview followed by key takeaways in bullet points and mention all the key topics covered in the video.
        Don't include the youtube source link in the summary.
        VIDEO CONTENT:
        {final_text}
    """)
    return res.content


# Generation
prompt = PromptTemplate(
    template="""
    You are a helpful YouTube AI assistant. 
    PRIMARY TASK(STRICTLY FOLLOW):
    - Your primary goal is to answer the [USER QUESTION] provided below.
    - Use the [CHAT HISTORY] ONLY for context (e.g., if the user refers to a previous point). 
    - DO NOT answer OLD questions from the chat history and do not greet again and again.

    VIDEO CONTENT:
    {context}

    CHAT HISTORY:
    {chat_history}

    USER QUESTION: 
    {question}

    INSTRUCTIONS:
    1. GENERAL CONVERSATION & GREETINGS:
       - Reply naturally and warmly.
       - Acknowledge that you are here to help with the video. You can mention that the video is about: {video_summary}
       - DO NOT include Source Links for general chat.
    
    2. TIMESTAMP QUERIES:
       - If the user asks about a specific time (e.g., "at 54:00"), use the closest available segments in the [VIDEO CONTENT].
       - Answer based on that content naturally. Simply state what is being discussed in that portion of the video.
       
    3. VIDEO QUESTIONS (INFORMATION FOUND):
       - Answer using ONLY the [VIDEO CONTENT] provided.
       - (CRITICAL) You MUST always append the source link at the end of your response,\nSource: https://youtu.be/{video_id}?t={seconds}s
       - Use the 'seconds' variable provided to you for the link.

    4. VIDEO QUESTIONS (INFORMATION NOT FOUND):
       - If the user asks about something not in the video, politely explain that it's not covered. 
       - Briefly mention the general theme of the video ({video_summary}) to be helpful and invite related questions.
       - DO NOT provide a source link if the answer is not found.
    
    5. PERSONAL OPINIONS (NOT GENERAL QUESTIONS):
       - If the user asks opinion about the video(if uses opinion, think, etc), start by saying: "As an AI assistant, I don't have personal opinions. However, based on the video content..." and then proceed to answer using the transcript content.

    6. FORMATTING:
       - Keep responses conversational, helpful, and grounded.
       - Respond in the same language as the [USER QUESTION].
    """,
    input_variables=[
        "context",
        "question",
        "video_id",
        "seconds",
        "chat_history",
        "video_summary",
    ],
)

parser = StrOutputParser()
rag_chain = prompt | open_router_model | parser

if __name__ == "__main__":
    from langchain_community.chat_message_histories import ChatMessageHistory

    history = ChatMessageHistory()
    summary_cache = None

    print("\nAI: Video processed. I'm ready!")

    while True:
        try:
            query = input("\nUser: ")
        except EOFError:
            break
        if query.lower() in ["exit", "quit"]:
            break

        intent = get_intent(query, history)
        print(f"(Intent: {intent})")

        if intent == "SUMMARY":
            if not summary_cache:
                summary_cache = get_universal_summary(chunks)
            context_text = summary_cache
            timestamp = 0
        else:
            # RAG Mode
            retrieved_docs = retriever.invoke(query)

            # Use the most relevant chunk's timestamp for the source link
            sorted_docs = sorted(
                retrieved_docs, key=lambda x: x.metadata.get("start", 0)
            )
            context_text = "\n\n".join(
                [f"[{d.metadata['start']}s]: {d.page_content}" for d in sorted_docs]
            )
            timestamp = retrieved_docs[0].metadata["start"] if retrieved_docs else 0

        # Final Answer Generation (keeping last 6 messages in the chat history)
        history_str = "\n".join(
            [f"{m.type}: {m.content}" for m in history.messages[-6:]]
        )

        result = rag_chain.invoke(
            {
                "context": context_text,
                "question": query,
                "video_id": video_id,
                "seconds": timestamp,
                "chat_history": history_str,
                "video_summary": video_summary,
            }
        )

        history.add_user_message(query)
        history.add_ai_message(result)

        print(f"\nAI ({intent} mode): {result}")
