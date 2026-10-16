import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import App from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import { AuthProvider } from "./hooks/useAuth";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, err) => count < 2 && !(err && "status" in err && [401, 403, 404, 410].includes((err as { status: number }).status)),
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider>
            <App />
            <Toaster
              theme="dark"
              position="bottom-right"
              toastOptions={{ style: { background: "#17171f", border: "1px solid #363645", color: "#f4f3f8" } }}
            />
          </TooltipProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
