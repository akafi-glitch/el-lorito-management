import type { FloorMap as FloorMapData } from "../layout";
import { STATUS_LABEL, STATUS_ORDER } from "../status";

import { FloorAreaCard } from "./floor-area-card";
import { STATUS_DOT } from "./status-styles";

export function FloorMap({ map }: { map: FloorMapData }) {
  return (
    <div className="flex flex-col gap-6">
      <ul aria-label="Table status counts" className="flex flex-wrap gap-x-6 gap-y-2">
        {STATUS_ORDER.map((status) => (
          <li key={status} className="flex items-center gap-2 text-base text-ink">
            <span aria-hidden="true" className={`size-3.5 rounded-full ${STATUS_DOT[status]}`} />
            <span>{STATUS_LABEL[status]}</span>
            <span className="font-bold tabular-nums">{map.counts[status]}</span>
          </li>
        ))}
      </ul>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr] lg:items-start">
        {map.areas.map((area) => (
          <FloorAreaCard key={area.code} area={area} />
        ))}
      </div>

      <section aria-labelledby="combinations-heading" className="rounded-2xl border border-glaze bg-paper p-4">
        <h2 id="combinations-heading" className="text-lg font-bold text-ink">
          Approved combinations
        </h2>
        <p className="mt-1 text-sm text-muted">
          Used for 7 or more guests when the Party areas are full. Over 12 guests, only X6 + X7 + X8. Staff can also
          join any tables by hand.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {map.combinations.map((combination) => (
            <li
              key={combination.code}
              className="rounded-lg border border-glaze px-3 py-2 text-base text-ink"
            >
              <span className="font-semibold">{combination.label}</span>
              <span className="text-muted">
                {", "}
                {combination.capacity === null ? "seats not set" : `${combination.capacity} chairs`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
