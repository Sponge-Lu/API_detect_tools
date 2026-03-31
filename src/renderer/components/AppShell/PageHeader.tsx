interface PageHeaderProps {
  title: string;
  description: string;
}

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <section className="shrink-0 px-6 py-5 border-b border-gray-200/80 dark:border-white/[0.08] bg-white/70 dark:bg-[#161618]/70 backdrop-blur-sm">
      <div className="max-w-5xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gray-400 dark:text-gray-500">
          Workspace
        </p>
        <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{description}</p>
      </div>
    </section>
  );
}
