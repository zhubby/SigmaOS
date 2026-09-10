import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

export function SkeletonBlock({ className = "", width }: { className?: string; width?: string }) {
  const style = width ? ({ "--skeleton-width": width } as CSSProperties) : undefined;
  return <span className={`management-skeleton-block ${className}`.trim()} style={style} aria-hidden="true" />;
}

export function ManagementSkeletonBody({
  tableColumns = 6,
  tableRows = 4,
  listRows = 3,
  gaugeRows = 4,
  variant = "default"
}: {
  tableColumns?: number;
  tableRows?: number;
  listRows?: number;
  gaugeRows?: number;
  variant?: "default" | "docker" | "storage";
}) {
  const { t } = useTranslation();

  return (
    <div className="management-skeleton-body" aria-busy="true" aria-label={t("common.states.loading")}>
      <section className="management-command-panel management-skeleton-command">
        <SkeletonBlock className="management-skeleton-emblem" />
        <div className="management-command-copy">
          <SkeletonBlock className="management-skeleton-status" width="92px" />
          <SkeletonBlock className="management-skeleton-title" width="42%" />
          <SkeletonBlock className="management-skeleton-copy-line" width="76%" />
          <dl className="management-fact-list management-skeleton-facts">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index}>
                <SkeletonBlock width="48%" />
                <SkeletonBlock width={index % 2 ? "68%" : "82%"} />
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="management-metric-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <article key={index} className="management-metric management-skeleton-metric">
            <SkeletonBlock className="management-skeleton-icon" />
            <SkeletonBlock width={index % 2 ? "54%" : "64%"} />
            <SkeletonBlock className="management-skeleton-metric-value" width={index === 2 ? "58%" : "38%"} />
            <SkeletonBlock width="74%" />
          </article>
        ))}
      </div>

      <section className="management-section management-table-section">
        <SkeletonSectionHeader />
        <div className="management-skeleton-table" style={{ "--skeleton-columns": tableColumns } as CSSProperties}>
          {Array.from({ length: tableRows }, (_, row) => (
            <div key={row} className="management-skeleton-table-row">
              {Array.from({ length: tableColumns }, (_, column) => (
                <SkeletonBlock key={column} width={column === 0 ? "72%" : column === tableColumns - 1 ? "48%" : "62%"} />
              ))}
            </div>
          ))}
        </div>
      </section>

      {variant === "docker" ? (
        <>
          <div className="docker-runtime-layout management-skeleton-docker-layout">
            <section className="management-section">
              <SkeletonSectionHeader />
              <div className="docker-pressure-body">
                <div className="docker-pressure-stat-grid">
                  {Array.from({ length: 2 }, (_, index) => (
                    <div key={index} className="docker-pressure-stat management-skeleton-pressure-stat">
                      <SkeletonBlock width="52%" />
                      <SkeletonBlock width="42%" />
                      <SkeletonBlock width="64%" />
                    </div>
                  ))}
                </div>
                <SkeletonBlock className="management-skeleton-pressure-chart" />
                <SkeletonBlock width="56%" />
              </div>
            </section>
            {Array.from({ length: 2 }, (_, section) => (
              <section key={section} className="management-section">
                <SkeletonSectionHeader />
                <div className="docker-inventory-list management-skeleton-inventory-list">
                  {Array.from({ length: 3 }, (_, index) => (
                    <div key={index} className="docker-inventory-row">
                      <SkeletonBlock className="management-skeleton-icon" />
                      <div><SkeletonBlock width={index % 2 ? "62%" : "76%"} /><SkeletonBlock width="48%" /></div>
                      <SkeletonBlock width="34px" />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <section className="management-section docker-compose-section">
            <SkeletonSectionHeader />
            <div className="management-workload-list management-skeleton-list">
              {Array.from({ length: listRows }, (_, index) => (
                <div key={index} className="management-workload management-skeleton-workload">
                  <SkeletonBlock className="management-skeleton-icon" />
                  <div><SkeletonBlock width="58%" /><SkeletonBlock width="84%" /></div>
                  <SkeletonBlock className="management-skeleton-status" width="52px" />
                  <SkeletonBlock width="42px" />
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
      <div className="management-lower-grid">
        <section className="management-section">
          <SkeletonSectionHeader />
          <div className="management-workload-list management-skeleton-list">
            {Array.from({ length: listRows }, (_, index) => (
              <div key={index} className="management-workload management-skeleton-workload">
                <SkeletonBlock className="management-skeleton-icon" />
                <div>
                  <SkeletonBlock width={index % 2 ? "58%" : "72%"} />
                  <SkeletonBlock width="84%" />
                </div>
                <SkeletonBlock className="management-skeleton-status" width="52px" />
                <SkeletonBlock width="42px" />
              </div>
            ))}
          </div>
        </section>

        <section className="management-section">
          <SkeletonSectionHeader />
          {variant === "storage" ? (
            <StorageHealthSkeleton />
          ) : (
            <div className="management-resource-list management-skeleton-resources">
              {Array.from({ length: gaugeRows }, (_, index) => (
                <div key={index} className="management-skeleton-resource">
                  <SkeletonBlock width={index % 2 ? "46%" : "58%"} />
                  <SkeletonBlock className="management-skeleton-gauge" />
                  <SkeletonBlock width="34%" />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  );
}

function SkeletonSectionHeader() {
  return (
    <header className="management-section-header management-skeleton-section-header">
      <div>
        <SkeletonBlock className="management-skeleton-section-title" width="42%" />
        <SkeletonBlock width="68%" />
      </div>
    </header>
  );
}

function StorageHealthSkeleton() {
  return (
    <div className="storage-health-chart management-skeleton-storage-health">
      <div className="storage-health-chart-layout">
        <SkeletonBlock className="management-skeleton-storage-radial" />
        <div className="storage-health-signal-list">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="storage-health-signal" key={index}>
              <SkeletonBlock className="management-skeleton-signal-dot" />
              <div><SkeletonBlock width={index % 2 ? "66%" : "78%"} /><SkeletonBlock width="92%" /></div>
              <SkeletonBlock width="34px" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FileListSkeleton({ rows = 7 }: { rows?: number }) {
  const { t } = useTranslation();

  return (
    <div className="file-list-skeleton" role="status" aria-label={t("common.states.loading")}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="file-row file-row-skeleton" aria-hidden="true">
          <span className="file-name"><SkeletonBlock className="file-skeleton-icon" /><SkeletonBlock width={index % 3 === 0 ? "48%" : "64%"} /></span>
          <span className="file-row-actions"><SkeletonBlock className="file-skeleton-action" /><SkeletonBlock className="file-skeleton-action" /></span>
          <SkeletonBlock width={index % 2 ? "34%" : "24%"} />
          <SkeletonBlock width={index % 2 ? "48%" : "38%"} />
        </div>
      ))}
    </div>
  );
}
