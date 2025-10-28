/**
 * 세라젬 V11 WebXR 최소 제어 스크립트
 * - 애니메이션 토글(0.3초 블렌딩), 디퓨즈 텍스처 순환, 모델 회전(Z축 90°)만 유지한다.
 * - DOM Overlay는 slot="ar-dom-overlay"로 직접 부착되어 있어 별도 이동 로직이 필요 없다.
 */

const modelViewer = document.querySelector("#catalog-viewer");
const arOverlay = document.querySelector("#ar-overlay");
const overlayHost = document.querySelector("#overlay-host");
const arOverlay = document.querySelector("#ar-overlay");
const animationToggleButton = document.querySelector("#animation-toggle-button");
const animationThumb = document.querySelector("#animation-thumb");
const hotspotButton = document.querySelector("#mode-hotspot");
const hotspotThumb = document.querySelector("#mode-hotspot-thumb");
const colorCycleButton = document.querySelector("#color-cycle-button");
const rotateButton = document.querySelector("#rotate-button");

const textureCache = new Map();

const ANIMATION_STATE_MAP = {
  chair: { label: "체어 모드", thumb: "img/V11_thumbnail.webp" },
  stretch: { label: "스트레치 모드", thumb: "img/V11_stretch_thumbnail.webp" },
};

const TEXTURE_SEQUENCE = [
  { id: "original", label: "기본 텍스처", uri: null },
  { id: "beige", label: "CERA V11 Beige", uri: "texture/CERA_V11_low_D_Beige.png" },
  { id: "olive", label: "CERA V11 Olive", uri: "texture/CERA_V11_low_D_Olive.png" },
];

let currentTextureIndex = 0;
let baseMaterial = null;
let baseColorTextureSlot = null;
let originalBaseTexture = null;
let chairAnimationName = null;
let stretchAnimationName = null;
let animationState = "chair";

const rotationState = {
  current: 0,
  from: 0,
  to: 0,
  startTime: 0,
  raf: null,
};

function attachOverlayToModelViewer() {
  if (arOverlay && !modelViewer.contains(arOverlay)) {
    modelViewer.appendChild(arOverlay);
  }
}

function restoreOverlayToHost() {
  if (overlayHost && arOverlay && arOverlay.parentElement !== overlayHost) {
    overlayHost.appendChild(arOverlay);
  }
}

function preventXRSelect(event) {
  event.preventDefault();
}

[animationToggleButton, colorCycleButton, rotateButton, hotspotButton]
  .filter(Boolean)
  .forEach((element) => {
    element.addEventListener("beforexrselect", preventXRSelect);
  });

modelViewer.addEventListener("load", () => {
  restoreOverlayToHost();
  captureBaseMaterial();
  detectAnimations();
  updateAnimationUI();
});

modelViewer.addEventListener("finished", () => {
  modelViewer.pause();
});

modelViewer.addEventListener("ar-status", (event) => {
  const status = event.detail.status;
  if (arOverlay) {
    arOverlay.dataset.arStatus = status;
  }

  if (status === "session-started") {
    attachOverlayToModelViewer();
    const overlayType = modelViewer?.xrSession?.domOverlayState?.type ?? "unknown";
    console.info(`[DOMOverlay] type: ${overlayType}`);
  } else {
    restoreOverlayToHost();
  }
});

function toggleAnimation() {
  if (!chairAnimationName || !stretchAnimationName) {
    console.warn("애니메이션 이름을 찾지 못했습니다.");
    return;
  }

  const nextState = animationState === "chair" ? "stretch" : "chair";
  const nextAnimation = nextState === "chair" ? chairAnimationName : stretchAnimationName;

  modelViewer.animationCrossfadeDuration = 300;
  modelViewer.animationLoop = false;
  modelViewer.animationName = nextAnimation;
  modelViewer.play({ repetitions: 1 });

  animationState = nextState;
  updateAnimationUI();
}

animationToggleButton?.addEventListener("click", toggleAnimation);
hotspotButton?.addEventListener("click", toggleAnimation);

colorCycleButton?.addEventListener("click", async () => {
  if (!baseMaterial) {
    console.warn("재질 정보를 찾을 수 없습니다.");
    return;
  }

  const previousIndex = currentTextureIndex;
  currentTextureIndex = (currentTextureIndex + 1) % TEXTURE_SEQUENCE.length;
  const textureInfo = TEXTURE_SEQUENCE[currentTextureIndex];

  try {
    await applyTextureInfo(textureInfo);
  } catch (error) {
    console.error("텍스처 적용 실패:", error);
    currentTextureIndex = previousIndex;
  }
});

rotateButton?.addEventListener("click", () => {
  startRotationAnimation(rotationState.current, rotationState.current + 90);
});

function startRotationAnimation(fromDeg, toDeg) {
  cancelRotationAnimation();

  rotationState.from = normalizeDegrees(fromDeg);
  rotationState.to = normalizeDegrees(toDeg);
  rotationState.startTime = null;

  const duration = 300;

  const step = (timestamp) => {
    if (rotationState.startTime === null) {
      rotationState.startTime = timestamp;
    }

    const elapsed = timestamp - rotationState.startTime;
    const t = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(t);
    const current =
      rotationState.from + shortestAngleDelta(rotationState.from, rotationState.to) * eased;

    applyModelRotation(current);

    if (t < 1) {
      rotationState.raf = requestAnimationFrame(step);
    } else {
      rotationState.current = normalizeDegrees(rotationState.to);
      rotationState.raf = null;
    }
  };

  rotationState.raf = requestAnimationFrame(step);
}

function cancelRotationAnimation() {
  if (rotationState.raf !== null) {
    cancelAnimationFrame(rotationState.raf);
    rotationState.raf = null;
  }
}

function applyModelRotation(angleDeg) {
  modelViewer.setAttribute("orientation", `0deg 0deg ${angleDeg.toFixed(2)}deg`);
  modelViewer.requestRender?.();
}

function normalizeDegrees(value) {
  const result = value % 360;
  return result < 0 ? result + 360 : result;
}

function shortestAngleDelta(fromDeg, toDeg) {
  let delta = normalizeDegrees(toDeg) - normalizeDegrees(fromDeg);
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function captureBaseMaterial() {
  const materials = modelViewer.model?.materials;
  if (!materials || materials.length === 0) {
    console.warn("모델에 재질 정보가 없습니다.");
    return;
  }

  baseMaterial = materials[0];
  baseColorTextureSlot = baseMaterial.pbrMetallicRoughness?.baseColorTexture ?? null;
  originalBaseTexture = baseColorTextureSlot?.texture ?? null;
}

function detectAnimations() {
  const available = modelViewer.availableAnimations || [];
  if (available.length === 0) {
    console.warn("사용 가능한 애니메이션이 없습니다.");
    return;
  }

  chairAnimationName =
    available.find((name) => name.toLowerCase().includes("chair")) ?? available[0];
  stretchAnimationName =
    available.find((name) => name.toLowerCase().includes("stretch")) ??
    available.find((name) => name !== chairAnimationName) ??
    available[0];

  modelViewer.animationName = chairAnimationName;
  modelViewer.animationLoop = false;
  modelViewer.animationCrossfadeDuration = 300;
  modelViewer.play({ repetitions: 1 });
  animationState = "chair";
}

function updateAnimationUI() {
  const config = ANIMATION_STATE_MAP[animationState];
  if (!config) return;

  animationThumb.src = config.thumb;
  animationThumb.alt = `${config.label} 썸네일`;
  hotspotThumb.src = config.thumb;
  hotspotThumb.alt = `${config.label} 썸네일`;

  const nextStateLabel =
    animationState === "chair"
      ? ANIMATION_STATE_MAP.stretch.label
      : ANIMATION_STATE_MAP.chair.label;

  animationToggleButton?.setAttribute("aria-label", `애니메이션 전환 - 다음: ${nextStateLabel}`);
  hotspotButton?.setAttribute("aria-label", `AR에서 ${nextStateLabel}로 전환`);
}

function preloadVariantTextures() {
  TEXTURE_SEQUENCE.forEach((texture) => {
    if (!texture.uri) return;

    getTextureForUri(texture.uri).catch((error) => {
      console.warn("텍스처 프리로드 실패:", error);
    });
  });
}

async function applyTextureInfo(textureInfo) {
  if (!baseMaterial) {
    throw new Error("재질 정보가 존재하지 않습니다.");
  }

  const slot = baseMaterial.pbrMetallicRoughness?.baseColorTexture ?? baseColorTextureSlot;
  if (!slot || typeof slot.setTexture !== "function") {
    console.warn("baseColorTexture 슬롯을 찾을 수 없어 교체를 건너뜁니다.");
    return;
  }

  if (!textureInfo || !textureInfo.uri) {
    if (originalBaseTexture) {
      slot.setTexture(originalBaseTexture);
      baseColorTextureSlot = slot;
      modelViewer.requestRender?.();
    } else {
      console.warn("복원할 기본 텍스처가 없습니다.");
    }
    return;
  }

  const gltfTexture = await getTextureForUri(textureInfo.uri);
  if (!gltfTexture) {
    throw new Error(`텍스처 로드 실패: ${textureInfo.uri}`);
  }

  slot.setTexture(gltfTexture);
  baseColorTextureSlot = slot;
  modelViewer.requestRender?.();
}

async function getTextureForUri(uri) {
  if (!uri) return null;

  if (textureCache.has(uri)) {
    return textureCache.get(uri);
  }

  const texture = await modelViewer.createTexture(uri);
  textureCache.set(uri, texture);
  return texture;
}

// 초기 동작 준비
restoreOverlayToHost();
preloadVariantTextures();
