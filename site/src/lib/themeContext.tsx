import { createContext, useContext, type ReactNode } from "react";
import { useTheme, type Theme } from "./theme";

const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "dark", setTheme: () => {} });

/** One theme state for the whole page (the WebGL scenes need it as a value, not only as CSS). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useTheme();
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export const useThemeValue = () => useContext(Ctx).theme;
export const useSetTheme = () => useContext(Ctx).setTheme;
