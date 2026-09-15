// Draw-number URLs for the Singapore Pools results pages.
//
// Both pages take a single `sppl` query parameter: base64 of "DrawNumber=<n>".
// Omit it entirely and the page renders the most recent draw, which is how
// `latest` is resolved — there is no upward probing needed.

export type Game = "toto" | "4d";

const PAGES: Record<Game, string> = {
  toto: "https://www.singaporepools.com.sg/en/product/sr/Pages/toto_results.aspx",
  "4d": "https://www.singaporepools.com.sg/en/product/pages/4d_results.aspx",
};

/** URL for one specific draw. */
export function drawUrl(game: Game, drawNo: number): string {
  const sppl = Buffer.from(`DrawNumber=${drawNo}`).toString("base64");
  return `${PAGES[game]}?sppl=${encodeURIComponent(sppl)}`;
}

/** URL for whichever draw is currently most recent. */
export function latestUrl(game: Game): string {
  return PAGES[game];
}
