export function BeatFrame({ left, right }: { left: string; right: string }) {
  return (
    <div className="v6-beat-frame">
      <div className="font-mono-v6 mx-auto flex max-w-[80rem] items-center justify-between px-10 text-[11px] font-medium uppercase tracking-[0.08em] text-v6-graphite-3 max-[900px]:px-6 max-[900px]:text-[10px]">
        <span className="inline-flex items-center gap-[0.6rem]">
          <span className="inline-block h-[5px] w-[5px] rounded-full bg-v6-graphite-3" />
          {left}
        </span>
        <span>{right}</span>
      </div>
    </div>
  );
}
