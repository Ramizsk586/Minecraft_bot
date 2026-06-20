export interface BlockDropMap {
  [blockName: string]: string;
}

import * as blockDropMapJson from './blockDropMap.json';

export const blockDropMap: BlockDropMap = blockDropMapJson as any;

export function getDropForBlock(blockName: string): string {
  return blockDropMap[blockName] || blockName;
}
