interface ShinyTextProps {
  children: React.ReactNode;
  className?: string;
}

export default function ShinyText({ children, className }: ShinyTextProps) {
  return <span className={`shiny-text${className ? ` ${className}` : ''}`}>{children}</span>;
}
