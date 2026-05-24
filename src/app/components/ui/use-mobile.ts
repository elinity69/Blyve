import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/** Tailwind `md` and up — use for desktop-only UX (e.g. autofocus) so phones do not pop the keyboard. */
export function useIsMdUp() {
  const [isMdUp, setIsMdUp] = React.useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`).matches,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`);
    const onChange = () => setIsMdUp(mql.matches);
    mql.addEventListener("change", onChange);
    setIsMdUp(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMdUp;
}
