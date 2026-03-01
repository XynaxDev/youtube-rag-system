/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Landing } from "./pages/Landing";
import { Dashboard } from "./pages/Dashboard";
import { Summarize } from "./pages/Summarize";
import { Compare } from "./pages/Compare";
import { SummaryResult } from "./pages/SummaryResult";
import { History } from "./pages/History";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />

        {/* Dashboard Routes */}
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/summarize" element={<Summarize />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/summary-result" element={<SummaryResult />} />
          {/* Sidebar Routes */}
          <Route path="/history" element={<History />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
