import type { ReactNode } from "react";
import { TextAttributes } from "@opentui/core";
import { theme } from "./theme";

/** Full-screen container that centers its child. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {children}
    </box>
  );
}

/** Bordered, titled card. */
export function Card({
  title,
  children,
  width = 48,
}: {
  title: string;
  children: ReactNode;
  width?: number;
}) {
  return (
    <box
      title={` ${title} `}
      titleAlignment="center"
      style={{
        border: true,
        borderStyle: "rounded",
        borderColor: theme.border,
        titleColor: theme.accent,
        padding: 1,
        flexDirection: "column",
        width,
      }}
    >
      {children}
    </box>
  );
}

/** A labeled, focus-aware text field wrapper. Pass the <input> (or masked
 *  display) as children; the border turns accent when `focused`. */
export function Field({
  label,
  focused,
  children,
}: {
  label: string;
  focused: boolean;
  children: ReactNode;
}) {
  return (
    <box style={{ flexDirection: "column", marginTop: 1 }}>
      <text style={{ fg: focused ? theme.accent : theme.dim }}>{label}</text>
      <box
        style={{
          border: true,
          borderStyle: "rounded",
          borderColor: focused ? theme.accent : theme.border,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        {children}
      </box>
    </box>
  );
}

/** A bordered panel that grows to fill space — for the dashboard grid. */
export function Panel({
  title,
  grow,
  focused,
  children,
}: {
  title: string;
  grow?: number;
  focused?: boolean;
  children: ReactNode;
}) {
  return (
    <box
      title={` ${title} `}
      titleAlignment="left"
      style={{
        border: true,
        borderStyle: focused ? "heavy" : "rounded",
        borderColor: focused ? theme.accent : theme.border,
        titleColor: focused ? theme.accent : theme.dim,
        padding: 1,
        flexDirection: "column",
        flexGrow: grow ?? 0,
      }}
    >
      {children}
    </box>
  );
}

/** Dim helper / hint text. */
export function Hint({ children }: { children: ReactNode }) {
  return <text style={{ fg: theme.dim, marginTop: 1 }}>{children}</text>;
}

/** Status line: error (red), ok (green), or dim hint. */
export function Status({ kind, children }: { kind: "error" | "ok" | "dim"; children: ReactNode }) {
  const fg = kind === "error" ? theme.error : kind === "ok" ? theme.ok : theme.dim;
  return <text style={{ fg, marginTop: 1 }}>{children}</text>;
}

export const attrs = TextAttributes;
