/* eslint-disable @next/next/no-img-element */
export function MovieLinks({ title }: { title: string }) {
  const q = encodeURIComponent(title);
  return (
    <div className="movie-links">
      <a className="movie-link" target="_blank" rel="noopener" title="Letterboxd" href={`https://letterboxd.com/search/films/${q}/`}>
        <img className="movie-icon" src="/letterboxd.svg" alt="Letterboxd" />
      </a>
      <a className="movie-link" target="_blank" rel="noopener" title="Watch trailer" href={`https://www.youtube.com/results?search_query=${q}+trailer`}>
        <img className="movie-icon" src="/youtube.svg" alt="Trailer" />
      </a>
    </div>
  );
}
