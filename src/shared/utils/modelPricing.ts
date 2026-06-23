/**
 * 输入: ModelPriceInfo 与 usage 数据
 * 输出: 统一的模型价格解析与成本估算
 * 定位: 共享工具层 - 主进程统计与渲染层价格展示复用同一套计费语义
 */

import type { ModelPriceInfo } from '../types/site';

export const MODEL_PRICE_OBJECT_TO_CALL_RATIO = 0.001;
export const MODEL_TOKEN_PRICE_UNIT = 1_000_000;

export type ModelPricingMode = 'token' | 'perCall';

export interface ResolvedModelPricing {
  mode: ModelPricingMode;
  inputPrice: number | null;
  outputPrice: number | null;
  callPrice: number | null;
}

export interface ModelUsageForCost {
  promptTokens?: number;
  completionTokens?: number;
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

export function estimateModelCostUsd(
  pricingData: ModelPriceInfo | undefined,
  usage: ModelUsageForCost
): number | null {
  const resolved = resolveModelPricing(pricingData);

  if (resolved.mode === 'perCall') {
    return resolved.callPrice !== null ? resolved.callPrice : null;
  }

  const promptTokens = toFiniteNumber(usage.promptTokens);
  const completionTokens = toFiniteNumber(usage.completionTokens);
  if (promptTokens === null && completionTokens === null) {
    return null;
  }

  let cost = 0;
  let hasPriceAndUsage = false;
  if (promptTokens !== null && resolved.inputPrice !== null) {
    cost += (promptTokens / MODEL_TOKEN_PRICE_UNIT) * resolved.inputPrice;
    hasPriceAndUsage = true;
  }
  if (completionTokens !== null && resolved.outputPrice !== null) {
    cost += (completionTokens / MODEL_TOKEN_PRICE_UNIT) * resolved.outputPrice;
    hasPriceAndUsage = true;
  }

  return hasPriceAndUsage ? cost : null;
}

export function formatModelPrice(price: number): string {
  if (price === 0) return '0';
  if (price >= 1) return parseFloat(price.toFixed(2)).toString();
  if (price >= 0.01) return parseFloat(price.toFixed(4)).toString();
  return parseFloat(price.toFixed(6)).toString();
}
