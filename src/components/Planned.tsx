export function Planned({ title, phase, children }: { title: string; phase: string; children: React.ReactNode }) {
  return (
    <>
      <h1>{title}</h1>
      <div className="banner info" role="status">
        Not built yet. This area is planned for {phase}. It will read from the same automatically refreshed, source-tracked database as the Today page.
      </div>
      <div className="card">{children}</div>
    </>
  );
}
