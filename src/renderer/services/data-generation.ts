let epoch = 0;
export const currentDataEpoch = (): number => epoch;
export function invalidateDataEpoch(): void {
  epoch++;
}
