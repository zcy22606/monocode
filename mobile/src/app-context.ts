import { createContext, useContext } from "react";
import type { ConnectionInfo } from "./host/rpc";

export const AppContext = createContext<{ connection: ConnectionInfo; disconnect: () => void; online: boolean }>(null!);
export const useApp = () => useContext(AppContext);
