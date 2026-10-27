type WordmarkProps = { size?: "large" | "small" };

/** Restaurant name and subtitle. Large on the home and sign-in screens, small in the top bar. */
export function Wordmark({ size = "large" }: WordmarkProps) {
  if (size === "small") {
    return (
      <span className="flex flex-col leading-none">
        <span className="text-lg font-black tracking-[0.12em] text-white">EL LORITO</span>
        <span className="mt-1 text-xs text-white/75">Mexican Restaurant</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-center text-center leading-none">
      <span className="text-5xl font-black tracking-[0.14em] text-white sm:text-7xl">EL LORITO</span>
      <span className="mt-3 text-lg text-white/85 sm:text-xl">Mexican Restaurant</span>
    </span>
  );
}
