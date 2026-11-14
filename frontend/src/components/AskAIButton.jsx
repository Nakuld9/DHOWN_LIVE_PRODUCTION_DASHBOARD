// Contextual "Ask AI" — drop on any screen with a question; it hands the question
// to the agent fleet on the Ask AI page (which auto-asks a pending question).
import React from "react";
import { useNavigate } from "react-router-dom";

export default function AskAIButton({ question, label = "Ask AI", style = {} }) {
  const nav = useNavigate();
  const go = () => { try { sessionStorage.setItem("dhown_ai_q", question); } catch {} nav("/ask-ai"); };
  return (
    <button onClick={go} title={question}
      style={{ background: "transparent", color: "var(--yellow)", border: "1px solid var(--yellow-edge, var(--gold-edge))", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", ...style }}>
      ✦ {label}
    </button>
  );
}
