import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { WorkspacePage } from "@/pages/WorkspacePage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<WorkspacePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
