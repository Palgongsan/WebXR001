/**
 * 세라젬 V11 WebXR DOM Overlay 제어 스크립트
 * ---------------------------------------------------------------------------
 * - root/ref/ar-barebones.html의 WebXR 세션 흐름을 참고하여, <model-viewer>의 enterAR()
 *   유틸리티와 DOM Overlay 슬롯을 조합한 구현이다.
 * - DOM Overlay 루트(#ar-overlay)는 평상시 overlay-host 안에 두고, AR 세션 직전에만
 *   <model-viewer> 내부로 이동시켜 domOverlay 옵션을 충족한다.
 * - 각 UI 요소는 beforexrselect 이벤트에서 기본 제스처를 취소하여 XR 입력과의 충돌을 막는다.
 */

const modelViewer = document.querySelector("#catalog-viewer");
const overlayHost = document.querySelector("#overlay-host");
const arOverlay = document.querySelector("#ar-overlay");
const domOverlayStateEl = document.querySelector("#dom-overlay-state");
const sessionStatusEl = document.querySelector("#ar-session-status");
const enterARButton = document.querySelector("#enter-ar-button");
const animationToggleButton = document.querySelector("#animation-toggle-button");
const animationThumb = document.querySelector("#animation-thumb");
const hotspotButton = document.querySelector("#mode-hotspot");
const hotspotThumb = document.querySelector("#mode-hotspot-thumb");
const colorCycleButton = document.querySelector("#color-cycle-button");
const rotateButton = document.querySelector("#rotate-button");
const exposureSlider = document.querySelector("#exposure-slider");
const dimensionPanel = document.querySelector("#dimension-info");
const dimWidthEl = document.querySelector("#dim-width");
const dimHeightEl = document.querySelector("#dim-height");
const dimDepthEl = document.querySelector("#dim-depth");
const cameraToast = document.querySelector("#camera-toast");

const textureCache = new Map(); // model-viewer.createTexture() 결과 캐싱

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
let baseColorTextureInfo = null;
let originalBaseTexture = null;
let chairAnimationName = null;
let stretchAnimationName = null;
let animationState = "chair";

const rotationState = {
  currentY: 0,
  animationId: null,
  startTime: 0,
  from: 0,
  to: 0,
};

let dimensionLoopId = null;
let arSessionHasShownToast = false;

function preventXRSelect(event) {
  event.preventDefault();
}

arOverlay.addEventListener("beforexrselect", preventXRSelect);
hotspotButton.addEventListener("beforexrselect", preventXRSelect);

function attachOverlayToModelViewer() {
  if (!modelViewer.contains(arOverlay)) {
    modelViewer.appendChild(arOverlay);
  }
}

function restoreOverlayToHost() {
  if (overlayHost && arOverlay.parentElement !== overlayHost) {
    overlayHost.appendChild(arOverlay);
  }
}

modelViewer.addEventListener("load", () => {
  captureBaseMaterial();
  detectAnimations();
  updateAnimationUI();
  updateEnterARAvailability();
  updateDimensionReadout();
  preloadVariantTextures();
});

modelViewer.addEventListener("finished", () => {
  modelViewer.pause();
});

modelViewer.addEventListener("ar-status", (event) => {
  const status = event.detail.status;
  const reason = event.detail.reason ?? "";

  arOverlay.dataset.arStatus = status;
  sessionStatusEl.textContent = status === "session-started" ? "세션 진행 중" : status;

  if (status === "session-started") {
    attachOverlayToModelViewer();

    const overlayType = modelViewer.xrSession?.domOverlayState?.type ?? "미확인";
    domOverlayStateEl.textContent = overlayType;
    console.info(`[DOMOverlay] 유형: ${overlayType}`);

    enterARButton.innerHTML = `<img src="img/AR in.png" alt="" aria-hidden="true" /><span>AR 종료</span>`;
    enterARButton.setAttribute("aria-label", "AR 세션 종료");

    if (!arSessionHasShownToast && cameraToast) {
      cameraToast.dataset.dismissed = "true";
      cameraToast.style.opacity = "0";
      arSessionHasShownToast = true;
    }
  } else if (status === "failed") {
    domOverlayStateEl.textContent = `시작 실패 (${reason || "원인 확인 필요"})`;
    enterARButton.innerHTML = `<img src="img/AR in.png" alt="" aria-hidden="true" /><span>재시도</span>`;
    enterARButton.setAttribute("aria-label", "AR 세션 재시도");
    restoreOverlayToHost();
  } else {
    domOverlayStateEl.textContent = status === "not-presenting" ? "대기 중" : status;
    enterARButton.innerHTML = `<img src="img/AR in.png" alt="" aria-hidden="true" /><span>AR 시작</span>`;
    enterARButton.setAttribute("aria-label", "AR 세션 시작");
    restoreOverlayToHost();
  }
});

enterARButton.addEventListener("click", async () => {
  const status = arOverlay.dataset.arStatus;

  if (status === "session-started" && modelViewer.xrSession) {
    await modelViewer.xrSession.end();
    return;
  }

  if (!modelViewer.canActivateAR) {
    sessionStatusEl.textContent = "AR 미지원 환경 (HTTPS + 호환 기기 필요)";
    domOverlayStateEl.textContent = "지원되지 않음";
    return;
  }

  try {
    attachOverlayToModelViewer();
    await modelViewer.enterAR();
  } catch (error) {
    console.error("AR 세션 시작 실패:", error);
    sessionStatusEl.textContent = "세션 시작 실패";
    domOverlayStateEl.textContent = "에러 발생";
    restoreOverlayToHost();
  }
});

function toggleAnimation() {
  if (!chairAnimationName || !stretchAnimationName) {
    console.warn("애니메이션 이름을 찾지 못했습니다. GLB 애니메이션 구성을 확인하세요.");
    return;
  }

  const nextState = animationState === "chair" ? "stretch" : "chair";
  const nextAnimation = nextState === "chair" ? chairAnimationName : stretchAnimationName;

  modelViewer.animationCrossfadeDuration = 3000;
  modelViewer.animationLoop = false;
  modelViewer.animationName = nextAnimation;
  modelViewer.play({ repetitions: 1 });

  animationState = nextState;
  updateAnimationUI();
}

animationToggleButton.addEventListener("click", toggleAnimation);
hotspotButton.addEventListener("click", toggleAnimation);

/**
 * 디퓨즈 텍스처 순환 처리 (기본 → Beige → Olive → 기본).
 */
colorCycleButton.addEventListener("click", async () => {
  if (!baseMaterial) {
    console.warn("재질 정보를 찾을 수 없습니다. 모델 구조 확인 필요.");
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
    return;
  }

  colorCycleButton.setAttribute(
    "aria-label",
    `디퓨즈 텍스처 순환 - 현재: ${textureInfo.label}`,
  );
});

rotateButton.addEventListener("click", () => {
  startRotationAnimation(rotationState.currentY, rotationState.currentY + 90);
});

function startRotationAnimation(fromDeg, toDeg) {
  cancelRotationAnimation();

  rotationState.from = normalizeDegrees(fromDeg);
  rotationState.to = normalizeDegrees(toDeg);
  rotationState.startTime = null;

  const duration = 300; // ms

  const step = (timestamp) => {
    if (!rotationState.startTime) {
      rotationState.startTime = timestamp;
    }

    const elapsed = timestamp - rotationState.startTime;
    const t = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(t);
    const current =
      rotationState.from + shortestAngleDelta(rotationState.from, rotationState.to) * eased;

    applyModelRotation(current);

    if (t < 1) {
      rotationState.animationId = requestAnimationFrame(step);
    } else {
      rotationState.currentY = normalizeDegrees(rotationState.to);
      rotationState.animationId = null;
    }
  };

  rotationState.animationId = requestAnimationFrame(step);
}

function cancelRotationAnimation() {
  if (rotationState.animationId !== null) {
    cancelAnimationFrame(rotationState.animationId);
    rotationState.animationId = null;
  }
}

function applyModelRotation(yawDeg) {
  modelViewer.setAttribute("orientation", `0deg ${yawDeg.toFixed(2)}deg 0deg`);
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

exposureSlider.addEventListener("input", (event) => {
  const value = Number.parseFloat(event.target.value);
  modelViewer.exposure = Number.isFinite(value) ? value : 1;
});

modelViewer.addEventListener("interaction-start", () => {
  dimensionPanel.classList.add("visible");
  dimensionPanel.setAttribute("aria-hidden", "false");
  startDimensionLoop();
});

modelViewer.addEventListener("interaction-end", () => {
  stopDimensionLoop();
  dimensionPanel.classList.remove("visible");
  dimensionPanel.setAttribute("aria-hidden", "true");
});

function startDimensionLoop() {
  stopDimensionLoop();
  const loop = () => {
    updateDimensionReadout();
    dimensionLoopId = requestAnimationFrame(loop);
  };
  dimensionLoopId = requestAnimationFrame(loop);
}

function stopDimensionLoop() {
  if (dimensionLoopId !== null) {
    cancelAnimationFrame(dimensionLoopId);
    dimensionLoopId = null;
  }
}

function updateDimensionReadout() {
  const dimensions = modelViewer.getDimensions?.();
  if (!dimensions) {
    dimWidthEl.textContent = dimHeightEl.textContent = dimDepthEl.textContent = "-";
    return;
  }

  dimWidthEl.textContent = formatMetersToCentimeters(dimensions.x);
  dimHeightEl.textContent = formatMetersToCentimeters(dimensions.y);
  dimDepthEl.textContent = formatMetersToCentimeters(dimensions.z);
}

function formatMetersToCentimeters(value) {
  return `${(value * 100).toFixed(1)} cm`;
}

function captureBaseMaterial() {
  const materials = modelViewer.model?.materials;
  if (!materials || materials.length === 0) {
    console.warn("모델에 재질 정보가 없습니다.");
    return;
  }

  baseMaterial = materials[0];
  baseColorTextureInfo = baseMaterial.pbrMetallicRoughness?.baseColorTexture ?? null;
  originalBaseTexture = baseColorTextureInfo?.texture ?? null;
}

function detectAnimations() {
  const available = modelViewer.availableAnimations || [];
  if (available.length === 0) {
    console.warn("사용 가능한 애니메이션이 없습니다. GLB 애니메이션 포함 여부를 확인하세요.");
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
  modelViewer.animationCrossfadeDuration = 3000;
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

  animationToggleButton.setAttribute("aria-label", `애니메이션 전환 - 다음: ${nextStateLabel}`);
  hotspotButton.setAttribute("aria-label", `AR 공간에서 ${nextStateLabel}로 전환`);
}

function preloadVariantTextures() {
  TEXTURE_SEQUENCE.forEach((texture) => {
    if (!texture.uri) return;

    getTextureForUri(texture.uri).catch((error) => {
      console.warn("텍스처 프리로드 실패:", error);
    });
  });
}

function updateEnterARAvailability() {
  if (!enterARButton) return;
  if (!("canActivateAR" in modelViewer)) {
    enterARButton.disabled = false;
    return;
  }
  enterARButton.disabled = !modelViewer.canActivateAR;
}

if (navigator.xr?.addEventListener) {
  navigator.xr.addEventListener("devicechange", updateEnterARAvailability);
}

async function applyTextureInfo(textureInfo) {
  if (!baseMaterial) {
    throw new Error("재질 정보가 존재하지 않습니다.");
  }

  const pbr = baseMaterial.pbrMetallicRoughness;
  const slot = pbr?.baseColorTexture ?? baseColorTextureInfo;

  if (!slot || typeof slot.setTexture !== "function") {
    console.warn("baseColorTexture 슬롯이 없어 텍스처를 교체할 수 없습니다.");
    return;
  }

  if (!textureInfo || !textureInfo.uri) {
    if (originalBaseTexture) {
      slot.setTexture(originalBaseTexture);
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
  baseColorTextureInfo = pbr.baseColorTexture ?? slot;
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

restoreOverlayToHost();
updateEnterARAvailability();
updateDimensionReadout();

// TODO: 추후 분석/로그 연동 시 enterAR, texture 전환, 회전 이벤트 지점에 로깅을 추가할 것.
