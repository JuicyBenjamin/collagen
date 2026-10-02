/** /review/<ticketId> — the one thing the url carries. */
export const ticketId = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] ?? "");
