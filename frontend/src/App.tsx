/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Layout } from "./components/Layout";
import { Landing } from "./pages/Landing";
import { Dashboard } from "./pages/Dashboard";
import { Summarize } from "./pages/Summarize";
import { Compare } from "./pages/Compare";
import { CompareResult } from "./pages/CompareResult";
import { SummaryResult } from "./pages/SummaryResult";
import { History } from "./pages/History";
import { ToastProvider } from "./components/GlobalToast";
import { Toaster } from "./components/ui/sonner";
import { useLenis } from "lenis/react";

function LenisRouteSync() {
  const location = useLocation();
  const lenis = useLenis();

  useEffect(() => {
    requestAnimationFrame(() => {
      lenis?.resize();
    });
  }, [lenis, location.pathname]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <LenisRouteSync />
        <Routes>
          <Route path="/" element={<Landing />} />

          {/* Dashboard Routes */}
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/summarize" element={<Summarize />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/compare-result" element={<CompareResult />} />
            <Route path="/summary-result" element={<SummaryResult />} />
            {/* Sidebar Routes */}
            <Route path="/history" element={<History />} />
          </Route>
        </Routes>
        <Toaster />
      </ToastProvider>
    </BrowserRouter>
  );
}
