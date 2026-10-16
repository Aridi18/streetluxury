import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { PageLoader } from "./components/ui/misc";
import Landing from "./pages/Landing";
import { Login, Register } from "./pages/Auth";
import NotFound from "./pages/NotFound";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const NewRecording = lazy(() => import("./pages/NewRecording"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Report = lazy(() => import("./pages/Report"));
const Compare = lazy(() => import("./pages/Compare"));
const ComparisonView = lazy(() => import("./pages/ComparisonView"));
const HistoryPage = lazy(() => import("./pages/History"));
const Settings = lazy(() => import("./pages/Settings"));
const SystemStatus = lazy(() => import("./pages/SystemStatus"));

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="new" element={<NewRecording />} />
          <Route path="recordings/:id" element={<Workspace />} />
          <Route path="analyses/:id" element={<Report />} />
          <Route path="compare" element={<Compare />} />
          <Route path="compare/:id" element={<ComparisonView />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="settings" element={<Settings />} />
          <Route path="system" element={<SystemStatus />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
