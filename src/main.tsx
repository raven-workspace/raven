import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";
import "./styles/global.css";
import "./styles/base.scss";
import App from "./App";
import { loadFonts } from "./lib/loadFonts";
import { makeQueryClient } from "./lib/queryClient";

const queryClient = makeQueryClient();

// Mount once the bundled fonts are in (or a short timeout passes), so no text swaps fonts after it's on screen.
void loadFonts().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
