import { useEffect, useRef } from 'react';
import type { SearchHit } from '../lib/search';
import type { Reference } from '../lib/types';
import { ReferenceRow } from './ReferenceRow';

interface Props {
  hits: SearchHit[];
  activeIndex: number;
  listId: string;
  onHover: (index: number) => void;
  onShare: (ref: Reference) => void;
}

export const optionId = (listId: string, index: number) => `${listId}-opt-${index}`;

export function ResultList({ hits, activeIndex, listId, onHover, onShare }: Props) {
  const activeRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <ul className="results" role="listbox" id={listId} aria-label="Resultados">
      {hits.map(({ ref }, index) => {
        const active = index === activeIndex;
        return (
          <li
            key={ref.id}
            id={optionId(listId, index)}
            ref={active ? activeRef : undefined}
            role="option"
            aria-selected={active}
            className={active ? 'result is-active' : 'result'}
            onMouseMove={() => !active && onHover(index)}
          >
            <ReferenceRow reference={ref} onShare={onShare} />
          </li>
        );
      })}
    </ul>
  );
}
