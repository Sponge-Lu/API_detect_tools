import type { ModelPriceInfo } from '../../shared/types/site';

export const MODEL_PRICE_OBJECT_TO_CALL_RATIO = 0.001;

export type ModelPricingMode = 'token' | 'perCall';

export interface ResolvedModelPricing {
  mode: ModelPricingMode;
  inputPrice: number | null;
  outputPrice: number | null;
  callPrice: number | null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function isModelPriceObject(
  value: ModelPriceInfo['model_price']
): value is { input?: number; output?: number } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPerCallPricing(pricingData: ModelPriceInfo | undefined): boolean {
  return pricingData?.quota_type === 1 || pricingData?.type === 'times';
}

export function resolveModelPricing(pricingData: ModelPriceInfo | undefined): ResolvedModelPricing {
  const perCall = isPerCallPricing(pricingData);
  const directInput = toFiniteNumber(pricingData?.input);
  const directOutput = toFiniteNumber(pricingData?.output);

  if (perCall) {
    if (directInput !== null || directOutput !== null) {
      return {
        mode: 'perCall',
        inputPrice: directInput,
        outputPrice: directOutput,
        callPrice: directInput ?? directOutput,
      };
    }

    if (isModelPriceObject(pricingData?.model_price)) {
      const inputPrice = toFiniteNumber(pricingData.model_price.input);
      const outputPrice = toFiniteNumber(pricingData.model_price.output);
      const callPrice = inputPrice ?? outputPrice;
      return {
        mode: 'perCall',
        inputPrice,
        outputPrice,
        callPrice: callPrice !== null ? callPrice * MODEL_PRICE_OBJECT_TO_CALL_RATIO : null,
      };
    }

    const scalarModelPrice = toFiniteNumber(pricingData?.model_price);
    return {
      mode: 'perCall',
      inputPrice: null,
      outputPrice: null,
      callPrice: scalarModelPrice,
    };
  }

  if (directInput !== null || directOutput !== null) {
    return {
      mode: 'token',
      inputPrice: directInput,
      outputPrice: directOutput,
      callPrice: null,
    };
  }

  if (isModelPriceObject(pricingData?.model_price)) {
    return {
      mode: 'token',
      inputPrice: toFiniteNumber(pricingData.model_price.input),
      outputPrice: toFiniteNumber(pricingData.model_price.output),
      callPrice: null,
    };
  }

  const modelRatio = toFiniteNumber(pricingData?.model_ratio);
  const completionRatio = toFiniteNumber(pricingData?.completion_ratio);
  if (modelRatio !== null || completionRatio !== null) {
    const normalizedModelRatio = modelRatio ?? 1;
    return {
      mode: 'token',
      inputPrice: normalizedModelRatio * 2,
      outputPrice: normalizedModelRatio * (completionRatio ?? 1) * 2,
      callPrice: null,
    };
  }

  return {
    mode: 'token',
    inputPrice: null,
    outputPrice: null,
    callPrice: null,
  };
}
