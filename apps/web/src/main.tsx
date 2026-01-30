import React from "react";
import ReactDOM from "react-dom/client";
import "xterm/css/xterm.css";
import "highlight.js/styles/github.css";
import "./styles.css";
import { App } from "./ui/App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <App />,
);

