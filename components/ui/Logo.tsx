export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: { bar: 'h-5 w-0.5', text1: 'text-sm', text2: 'text-xs', title: 'text-lg' }, md: { bar: 'h-7 w-0.5', text1: 'text-base', text2: 'text-xs', title: 'text-xl' }, lg: { bar: 'h-10 w-1', text1: 'text-xl', text2: 'text-sm', title: 'text-3xl' } }
  const s = sizes[size]
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <div style={{ background: '#E30513' }} className={`${s.bar} rounded-sm`} />
        <div className="flex flex-col leading-none">
          <span style={{ color: '#E30513' }} className={`${s.text1} font-bold tracking-tight`}>
            Assembl<span className="italic">!</span>age
          </span>
          <span style={{ color: '#697280' }} className={`${s.text2} font-medium tracking-widest uppercase`}>ingénierie</span>
        </div>
      </div>
      <span style={{ color: '#222222' }} className={`${s.title} font-black tracking-tight`}>
        <span style={{ color: '#E30513' }}>AI</span> chantier
      </span>
    </div>
  )
}
