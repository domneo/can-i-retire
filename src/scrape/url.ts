// URLs for the Singapore Pools results pages and their draw-list index files.

export type Game = "toto" | "4d";

const PAGES: Record<Game, string> = {
  toto: "https://www.singaporepools.com.sg/en/product/sr/Pages/toto_results.aspx",
  "4d": "https://www.singaporepools.com.sg/en/product/pages/4d_results.aspx",
};

/**
 * Static files the results pages fetch client-side to fill their draw
 * dropdown. Each is a bare <select> of every draw the site still offers —
 * about three years, newest first, with the draw number in `value` and the
 * date as the option text.
 *
 * This is why there is no upward probing anywhere in this project: the site
 * publishes the list of valid draw numbers itself.
 */
const DRAW_LISTS = {
  toto: "toto_result_draw_list_en.html",
  "4d": "fourd_result_draw_list_en.html",
  // TOTO cascade and Hongbao draws are NOT a separate number sequence — they
  // appear in the main list too. These files are how you tell which is which.
  "toto-cascade": "toto_result_cascade_draw_list_en.html",
  "toto-hongbao": "toto_result_hongbao_draw_list_en.html",
} as const;

export type DrawListName = keyof typeof DRAW_LISTS;

const ARCHIVE = "https://www.singaporepools.com.sg/DataFileArchive/Lottery/Output/";

/** URL for one specific draw. */
export function drawUrl(game: Game, drawNo: number): string {
  const sppl = Buffer.from(`DrawNumber=${drawNo}`).toString("base64");
  return `${PAGES[game]}?sppl=${encodeURIComponent(sppl)}`;
}

/** URL of one draw-list index file. */
export function drawListUrl(name: DrawListName): string {
  return ARCHIVE + DRAW_LISTS[name];
}
