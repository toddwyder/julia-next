const later = setTimeout;

export const wait = (run) => later(run, 0);
