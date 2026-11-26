import type { SheetBlock } from '../types/vtt';

export const STARTER_ASSETS = {
  tavernScene: './src/assets/images/scene_tavern_facade_1795656812379.jpg',
  tacticalCrypt: './src/assets/images/scene_tactical_crypt_1795656813259.jpg',
  rainyOffice: './src/assets/images/scene_rainy_office_1795656815931.jpg',
  waxLetter: './src/assets/images/handout_wax_letter_1795656818133.jpg',
  npcArchivist: './src/assets/images/handout_npc_archivist_1795656818200.jpg',
} as const;

export const DEFAULT_WIKI_FOLDERS = ['NPCs', 'Locais', 'Pistas', 'Sessões'] as const;

export function createBlankSheetBlocks(): SheetBlock[] {
  return [
    {
      id: `blk_${Date.now().toString(36)}_1`,
      type: 'bar',
      section: 'Recursos',
      label: 'Vida',
      current: 10,
      max: 10,
      barColor: '#8f2d2d',
    },
    {
      id: `blk_${Date.now().toString(36)}_2`,
      type: 'attribute',
      section: 'Atributos',
      label: 'Atributo Principal',
      value: 2,
      formula: '1d20 + {Atributo Principal}',
    },
    {
      id: `blk_${Date.now().toString(36)}_3`,
      type: 'text',
      section: 'Notas',
      label: 'Anotações e Equipamentos',
      text: '',
    },
  ];
}
