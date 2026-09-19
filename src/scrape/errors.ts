/** Thrown when a page loads but carries no results block for that draw. */
export class NoSuchDrawError extends Error {
  constructor(message = "page served no results block") {
    super(message);
    this.name = "NoSuchDrawError";
  }
}
