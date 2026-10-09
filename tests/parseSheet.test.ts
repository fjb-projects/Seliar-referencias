import { describe, expect, it } from 'vitest';
import { parseSheet } from '../scripts/lib/parseSheet';
import { cellsFrom } from './helpers';

// Fragments below are copied cell-for-cell from the real workbook.

describe('parseSheet: "Favaloro" layout (info + street blocks + references)', () => {
  const parse = parseSheet(
    'Favaloro',
    cellsFrom({
      A1: 'BARRIO FAVALORO',
      A3: 'Informacion General',
      F3: 'Calles de Este a Oeste',
      J3: 'Calles de Sur a Norte',
      A4: 'Ubicacion General',
      B4: '-31.567358, -60.702192',
      C4: 'c',
      F4: 'Sobre Calle',
      G4: 'Coodinada',
      H4: 'En Google Maps figura como',
      J4: 'Sobre Calle',
      K4: 'Coodinada',
      L4: 'En Google Maps figura como',
      A5: 'Esquema',
      B5: 'Casas',
      C5: 'c',
      F5: 'Sobre F Quiroga 3800',
      G5: '-31.566496, -60.699455',
      H5: 'Facundo Quiroga',
      I5: 'c',
      J5: 'Sobre Zavalla 10200',
      K5: '-31.570954, -60.697916',
      L5: 'Dr Zavalla',
      M5: 'c',
      A10: 'Referencias Propias y Cercanas',
      A11: 'Cancha Asociacion Favaloro',
      B11: '-31.570508, -60.699786',
      C11: 'c',
    }),
  );

  it('finds one barrio point, two streets and one reference', () => {
    expect(parse.titulo).toBe('BARRIO FAVALORO');
    const byTipo = Object.groupBy(parse.candidates, (c) => c.tipo);
    expect(byTipo.barrio).toHaveLength(1);
    expect(byTipo.calle).toHaveLength(2);
    expect(byTipo.referencia).toHaveLength(1);
  });

  it('keeps coordinate text, alias and marker as written', () => {
    const calle = parse.candidates.find((c) => c.nombre === 'Sobre F Quiroga 3800')!;
    expect(calle.coordTexts).toEqual(['-31.566496, -60.699455']);
    expect(calle.aliases).toEqual(['Facundo Quiroga']);
    expect(calle.direccion).toBe('F Quiroga 3800');
    expect(calle.marca).toBe('c');
    expect(calle.cell).toBe('G5');
  });

  it('leaves no unclassified cells', () => {
    expect(parse.orphans).toEqual([]);
  });
});

describe('parseSheet: street rows with irregular details', () => {
  it('drops the "No tiene ningun nombre" placeholder from aliases but keeps it in detalles, and keeps "ver" markers', () => {
    const parse = parseSheet(
      'Los Cipreses',
      cellsFrom({
        A1: 'BARRIO LOS CIPRESES',
        F3: 'Calles de Este a Oeste',
        F4: 'Sobre Calle',
        G4: 'Coodinada',
        H4: 'En Google Maps figura como',
        F5: 'Pasaje 34,50 8200',
        G5: '-31.593999, -60.679934',
        H5: 'No tiene ningun nombre',
        I5: 'ver',
      }),
    );
    const c = parse.candidates[0];
    expect(c.aliases).toEqual([]);
    expect(c.detalles['En Google Maps figura como']).toBe('No tiene ningun nombre');
    expect(c.marca).toBe('ver');
  });

  it('does not turn a row of stray markers into a street, and reports the cells', () => {
    const parse = parseSheet(
      'Pte Peron',
      cellsFrom({
        A1: 'PTE PERON',
        F3: 'Calles de Este a Oeste',
        F4: 'Sobre Calle',
        G4: 'Coodinada',
        H4: 'En Google Maps figura como',
        F5: 'Marcos Sastre 700',
        G5: '-31.617452, -60.676497',
        H5: 'Marco Sastre',
        F6: 'c',
        G6: 'c',
        H6: 'c',
      }),
    );
    expect(parse.candidates).toHaveLength(1);
    expect(parse.orphans.map((o) => o.address)).toEqual(['F6', 'G6', 'H6']);
  });
});

describe('parseSheet: text where a coordinate should be', () => {
  it('keeps the text as slotText and never invents a coordinate', () => {
    const parse = parseSheet(
      'Las Flores II',
      cellsFrom({
        A1: 'LAS FLORES II',
        A2: 'SECTOR TORRES',
        B3: 'TORRE 9',
        C3: 'TORRE 10',
        A4: 'Ubicacion ',
        B4: '-31.593546, -60.714102',
        C4: 'La Casa del Sabor',
        A5: 'Direccion',
        B5: '12 de infanteria 4285',
        C5: '12 de Infanteria 4100',
        B6: 'c',
        C6: 'c',
      }),
    );
    const ok = parse.candidates.find((c) => c.nombre === 'TORRE 9')!;
    const bad = parse.candidates.find((c) => c.nombre === 'TORRE 10')!;
    expect(ok.tipo).toBe('torre');
    expect(ok.coordTexts).toEqual(['-31.593546, -60.714102']);
    expect(ok.direccion).toBe('12 de infanteria 4285');
    expect(bad.coordTexts).toEqual([]);
    expect(bad.slotText).toBe('La Casa del Sabor');
    expect(bad.direccion).toBe('12 de Infanteria 4100');
  });
});

describe('parseSheet: grid with repeated headers and continuation rows (Fonavi Don Bosco)', () => {
  it('numbers repeated headers only when they repeat and joins extra "Ingresos"', () => {
    const parse = parseSheet(
      'Fonavi Don Bosco',
      cellsFrom({
        A1: 'FONAVI DON BOSCO',
        A3: 'Monoblok',
        B4: 'Monoblokc A',
        C4: 'Monoblokc B',
        A5: 'Ubicacion',
        B5: '-31.600479, -60.707084',
        C5: '-31.600115, -60.707281',
        B6: 'c',
        C6: 'c',
        A7: 'Ingresos',
        B7: 'Dr Zavalla 7000',
        C7: 'Dr Zavalla 7000',
        B8: 'Espora 3600',
        C8: 'Vieytes 3600',
      }),
    );
    const b = parse.candidates.find((c) => c.nombre === 'Monoblokc B')!;
    expect(b.tipo).toBe('monoblock');
    expect(b.direccion).toBe('Dr Zavalla 7000 / Vieytes 3600');
    expect(parse.orphans).toEqual([]);
  });
});

describe('parseSheet: free table of houses (Las Flores I)', () => {
  it('reads name | address | coordinate rows', () => {
    const parse = parseSheet(
      'Las Flores I',
      cellsFrom({
        A1: 'LAS FLORES I',
        A10: 'SECTOR CASAS',
        C10: 'Coordinada',
        A11: 'Del 1 al 10',
        B11: 'J Misericordioso 7300',
        C11: '-31.594018, -60.720533',
        D11: 'c',
      }),
    );
    expect(parse.candidates).toHaveLength(1);
    expect(parse.candidates[0]).toMatchObject({
      tipo: 'casa',
      nombre: 'Del 1 al 10',
      direccion: 'J Misericordioso 7300',
      coordTexts: ['-31.594018, -60.720533'],
    });
  });
});

describe('parseSheet: stray content is reported, not absorbed', () => {
  it('lists a lone coordinate cell outside any block', () => {
    const parse = parseSheet(
      'Gremio Solidario',
      cellsFrom({ A1: 'GREMIO SOLIDARIO', R2: '-31.821746, -60.854709' }),
    );
    expect(parse.candidates).toHaveLength(0);
    expect(parse.orphans.map((o) => o.address)).toEqual(['R2']);
  });
});

describe('parseSheet: several complexes side by side in one sheet (Torres en el puerto)', () => {
  const parse = parseSheet(
    'Torres en el puerto',
    cellsFrom({
      A1: 'TORRES AMARRAS',
      G1: 'TORRES AMARRAS CENTER',
      B3: 'Torre 1',
      H3: 'Torre 1',
      A4: 'Ubicacion por coordinadas',
      B4: '-31.653829, -60.699322',
      G4: 'Ubicacion por coordinadas',
      H4: '-31.652090, -60.697642',
      A5: 'Torre sobre',
      B5: '1ro de enero 27',
      G5: 'Torre sobre',
      H5: 'Sara Pinasco',
      B6: 'C',
      H6: 'c',
    }),
  );

  it('gives each block the title of its own complex', () => {
    const byAddr = Object.fromEntries(parse.candidates.map((c) => [c.cell, c.barrio]));
    expect(byAddr).toEqual({ B4: 'TORRES AMARRAS', H4: 'TORRES AMARRAS CENTER' });
  });

  it('does not set a per-block title in single-title sheets', () => {
    const single = parseSheet(
      'Lavalle 5000',
      cellsFrom({
        A1: 'LAVALLE 5000',
        B4: 'Torre 1',
        A5: 'Ubicacion por coordinadas',
        B5: '-31.624926, -60.680149',
        A6: 'Torre sobre',
        B6: 'Laprida 5054',
      }),
    );
    expect(single.candidates.map((c) => c.barrio)).toEqual([undefined]);
  });

  it('keeps "Referencias propias/cercanas" text of a tower searchable via its description', () => {
    const p = parseSheet(
      'Parque Sur',
      cellsFrom({
        A1: 'PARQUE SUR',
        B3: 'Torre 1',
        A4: 'Ubicacion por coordinadas',
        B4: '-31.636702, -60.657909',
        A5: 'Torre sobre',
        B5: 'J J Passo 2921',
        A7: 'Referencias propias',
        B7: 'Minimercado El Lago',
        A8: 'Referencias Cercanas',
        B8: 'Frente al Playon deportivo Parque Sur',
      }),
    );
    expect(p.candidates[0].descripcion).toContain('Minimercado El Lago');
    expect(p.candidates[0].descripcion).toContain('Playon deportivo');
  });
});
