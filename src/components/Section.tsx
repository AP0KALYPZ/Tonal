import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  index?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

export function Section({ title, index, action, children, className, id }: SectionProps) {
  return (
    <section className={`panel-section${className ? ` ${className}` : ''}`} id={id}>
      <header className="section-head">
        <div className="section-title-wrap">
          {index ? <span className="section-index">{index}</span> : null}
          <h2 className="section-title">{title}</h2>
        </div>
        {action ? <div className="section-action">{action}</div> : null}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}
