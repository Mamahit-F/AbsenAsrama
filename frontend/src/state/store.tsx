import React from "react";
import type { Role } from "./app";

export type { Role };

export function StoreProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
