// pnpm run scrape — fetch the most recent TOTO draw and upsert it.

import { latestUrl } from "../scrape/url.js";
import { archive, fetchPage } from "../scrape/fetch.js";
import { parseToto } from "../scrape/parse-toto.js";
import { upsertDraw } from "../db/queries.js";

const url = latestUrl("toto");
console.log(`fetching ${url}`);

const html = await fetchPage(url);
const draw = parseToto(html);

const path = await archive(`toto-${draw.drawNo}`, html);
upsertDraw(draw);

console.log(
  `draw ${draw.drawNo} (${draw.drawDate}): ` +
    `${draw.numbers.join(" ")} + ${draw.additional}  [raw: ${path}]`,
);
