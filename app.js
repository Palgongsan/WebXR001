/**
 * 세라젬 V11 WebXR 프로토타입 초기화 스크립트
 * ---------------------------------------------------------------------------
 * - root/ref/ar-barebones.html의 세션 흐름(지원 여부 체크 → dom-overlay 옵션 요청 →
 *   세션 종료 이벤트 처리)을 참고하여, 동일 내용을 <model-viewer> 기반 코드로 재구성한다.
 * - DOM Overlay는 slot 기반(root/ref/full index.txt 내 데모 구조)으로 유지하며,
 *   beforexrselect 이벤트를 적극적으로 사용해 XR 제스처와의 충돌을 방지한다.
 * - 필수 및 추가 기능(애니메이션 전환, 텍스처 교체, 치수 HUD, 회전 등)은 모두 한국어 주석을
 *   상세히 포함하여 실제 프로덕션 반영 시 TODO/수정 지점을 명확히 드러낸다.
 */

const modelViewer = document.querySelector("#catalog-viewer");
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

// 애니메이션 상태/썸네일 매핑. 파일 경로는 root/img/ 를 기준으로 한다.
const ANIMATION_STATE_MAP = {
  chair: {
    label: "체어 모드",
    thumb: "img/V11_thumbnail.webp",
  },
  stretch: {
    label: "스트레치 모드",
    thumb: "img/V11_stretch_thumbnail.webp",
  },
};

// 텍스처 순환 정의: uri가 null이면 최초 GLB에 포함된 기본 텍스처를 의미한다.
const TEXTURE_SEQUENCE = [
  { id: "original", label: "기본 텍스처", uri: null },
  { id: "beige", label: "CERA V11 Beige", uri: "texture/CERA_V11_low_D_Beige.png" },
  { id: "olive", label: "CERA V11 Olive", uri: "texture/CERA_V11_low_D_Olive.png" },
];

let currentTextureIndex = 0;
let baseMaterial = null;
let baseColorTexture = null;
let originalTextureUri = null;
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

/**
 * beforexrselect 이벤트 핸들러
 * -------------------------------------------------------------------------
 * - XR 세션 중 overlay 요소를 터치했을 때 입력이 XR 제스처(평면 찾기 등)로 전달되는
 *   것을 막기 위해 기본 동작을 취소한다.
 */
function preventXRSelect(event) {
  event.preventDefault();
}

arOverlay.addEventListener("beforexrselect", preventXRSelect);
hotspotButton.addEventListener("beforexrselect", preventXRSelect);

/**
 * 모델 로딩 완료 처리
 * -------------------------------------------------------------------------
 * - 재질/애니메이션/치수 정보를 한 번에 확보하고, UI 상태를 초기화한다.
 */
modelViewer.addEventListener("load", () => {
  captureBaseMaterial();
  detectAnimations();
  updateAnimationUI();
  updateEnterARAvailability();
  updateDimensionReadout();
});

/**
 * 애니메이션이 끝날 때마다 호출하여 최종 포즈를 유지한다.
 * (loop를 끈 상태로 repetitions=1 실행 후 pause 하지 않으면 마지막 프레임에서 정지 상태가 유지된다.)
 * 그래도 안전을 위해 finished 이벤트에서 일시정지로 확실히 고정.
 */
modelViewer.addEventListener("finished", () => {
  modelViewer.pause();
});

/**
 * AR 상태 변화 처리
 * -------------------------------------------------------------------------
 * - session-started / not-presenting / failed 상태별 UI, 텍스트, 버튼을 업데이트한다.
 * - domOverlayState.type(screen | floating | head-locked)을 HUD 및 콘솔에 출력한다.
 */
modelViewer.addEventListener("ar-status", (event) => {
  const status = event.detail.status;
  const reason = event.detail.reason ?? "";

  arOverlay.dataset.arStatus = status;
  sessionStatusEl.textContent = status === "session-started" ? "세션 진행 중" : status;

  if (status === "session-started") {
    const overlayType = modelViewer?.xrSession?.domOverlayState?.type ?? "미지원";
    domOverlayStateEl.textContent = overlayType;
    console.info(`[DOMOverlay] 현재 DOM Overlay 유형: ${overlayType}`);
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
  } else {
    domOverlayStateEl.textContent = status === "not-presenting" ? "대기 중" : status;
    enterARButton.innerHTML = `<img src="img/AR in.png" alt="" aria-hidden="true" /><span>AR 시작</span>`;
    enterARButton.setAttribute("aria-label", "AR 세션 시작");
  }
});

/**
 * AR 진입 버튼 클릭 처리
 * -------------------------------------------------------------------------
 * - canActivateAR을 통해 브라우저 지원 여부를 확인하고, 지원하지 않으면 안내 HUD를 갱신한다.
 * - 세션 중에는 XRSession.end()를 호출하여 종료한다.
 */
enterARButton.addEventListener("click", async () => {
  const currentStatus = arOverlay.dataset.arStatus;

  if (currentStatus === "session-started" && modelViewer.xrSession) {
    await modelViewer.xrSession.end();
    return;
  }

  if (!modelViewer.canActivateAR) {
    sessionStatusEl.textContent = "AR 미지원 환경 (HTTPS / 호환 브라우저 필요)";
    domOverlayStateEl.textContent = "지원되지 않음";
    return;
  }

  try {
    await modelViewer.enterAR();
  } catch (error) {
    console.error("AR 세션 시작 실패:", error);
    sessionStatusEl.textContent = "세션 시작 실패";
    domOverlayStateEl.textContent = "에러 발생";
  }
});

/**
 * 애니메이션 토글: 버튼 & 핫스팟에서 동일 로직 재사용
 * -------------------------------------------------------------------------
 * - animationCrossfadeDuration으로 3초 블렌딩을 적용한다.
 * - play({ repetitions: 1 }) 호출로 자연스럽게 재생 후 정지 상태를 유지한다.
 */
function toggleAnimation() {
  if (!chairAnimationName || !stretchAnimationName) {
    console.warn("애니메이션 이름을 찾지 못했습니다. GLB 내부 애니메이션 명칭 확인 필요.");
    return;
  }

  const nextState = animationState === "chair" ? "stretch" : "chair";
  const nextAnimation =
    nextState === "chair" ? chairAnimationName : stretchAnimationName;

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
 * 텍스처 순환 처리
 * -------------------------------------------------------------------------
 * - 최초 로딩 시 캡처한 baseColorTexture.source.uri를 활용해 기본 텍스처로 복귀한다.
 * - 추가 텍스처는 setURI로 재지정하며, model-viewer 내부 로더 캐시를 활용한다.
 */
colorCycleButton.addEventListener("click", () => {
  if (!baseMaterial || !baseColorTexture) {
    console.warn("재질 정보를 찾을 수 없습니다. 모델 구조 확인 필요.");
    return;
  }

  currentTextureIndex = (currentTextureIndex + 1) % TEXTURE_SEQUENCE.length;
  const textureInfo = TEXTURE_SEQUENCE[currentTextureIndex];

  if (textureInfo.uri) {
    baseColorTexture.texture.source.setURI(textureInfo.uri);
  } else if (originalTextureUri) {
    baseColorTexture.texture.source.setURI(originalTextureUri);
  }

  colorCycleButton.setAttribute(
    "aria-label",
    `컬러 텍스처 순환 - 현재: ${textureInfo.label}`,
  );
});

/**
 * 모델 회전 처리
 * -------------------------------------------------------------------------
 * - model-rotation 속성(Yaw)을 JS로 갱신하며, requestAnimationFrame을 이용해 0.3초 이징 애니메이션을 구현한다.
 * - 이징 함수는 easeInOutCubic을 사용해 덜컹거림을 방지한다.
 */
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
    const current = rotationState.from + shortestAngleDelta(rotationState.from, rotationState.to) * eased;

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
  modelViewer.setAttribute("model-rotation", `0deg ${yawDeg.toFixed(2)}deg 0deg`);
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

/**
 * 노출 슬라이더 → <model-viewer>의 exposure 속성과 매핑
 */
exposureSlider.addEventListener("input", (event) => {
  const value = Number.parseFloat(event.target.value);
  modelViewer.exposure = Number.isFinite(value) ? value : 1;
});

/**
 * 사용자 상호작용 시 치수 HUD를 표시하고, 조작 종료 후 숨긴다.
 * - getDimensions()는 모델의 바운딩 박스를 미터 단위로 반환하므로, 보기 좋은 cm 단위로 변환한다.
 */
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

/**
 * 치수 루프: 사용자가 드래그/핀치하는 동안 주기적으로 값을 갱신한다.
 */
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
    dimWidthEl.textContent = dimHeightEl.textContent = dimDepthEl.textContent =
      "데이터 없음";
    return;
  }

  dimWidthEl.textContent = formatMetersToCentimeters(dimensions.x);
  dimHeightEl.textContent = formatMetersToCentimeters(dimensions.y);
  dimDepthEl.textContent = formatMetersToCentimeters(dimensions.z);
}

function formatMetersToCentimeters(value) {
  return `${(value * 100).toFixed(1)} cm`;
}

/**
 * 모델 재질 정보를 확보하고, 기본 베이스 컬러 텍스처 URI를 저장한다.
 */
function captureBaseMaterial() {
  const materials = modelViewer.model?.materials;
  if (!materials || materials.length === 0) {
    console.warn("모델에 재질 정보가 없습니다.");
    return;
  }

  baseMaterial = materials[0];
  baseColorTexture = baseMaterial.pbrMetallicRoughness?.baseColorTexture ?? null;
  if (baseColorTexture?.texture?.source) {
    originalTextureUri = baseColorTexture.texture.source.uri;
  }
}

/**
 * 애니메이션 이름 탐색
 * -------------------------------------------------------------------------
 * - GLB 내부 애니메이션 이름이 스펙 문서(CERA_V11_ChairMode / Stretch)와 불일치할 가능성이 있으므로,
 *   toLowerCase() 후 부분 문자열을 찾아 안전하게 매핑한다.
 */
function detectAnimations() {
  const available = modelViewer.availableAnimations || [];
  if (available.length === 0) {
    console.warn("사용 가능한 애니메이션이 없습니다. GLB에 애니메이션이 포함되어 있는지 확인하세요.");
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

/**
 * 애니메이션 UI(썸네일 / 레이블 / aria) 갱신
 */
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

/**
 * 추가 텍스처 사전 로드: 빠른 전환을 위해 Image 객체를 생성해 브라우저 캐시에 적재한다.
 */
function preloadVariantTextures() {
  TEXTURE_SEQUENCE.forEach((texture) => {
    if (!texture.uri) return;
    const img = new Image();
    img.src = texture.uri;
  });
}

/**
 * AR 지원 여부가 변동될 수 있으므로, 버튼 활성화 상태를 즉시 갱신한다.
 */
function updateEnterARAvailability() {
  if (!enterARButton) return;
  if (!("canActivateAR" in modelViewer)) {
    enterARButton.disabled = false;
    return;
  }
  enterARButton.disabled = !modelViewer.canActivateAR;
}

/**
 * load 외에도 WebXR 디바이스 변경 시 canActivateAR이 바뀔 수 있으므로 감지한다.
 */
if (navigator.xr?.addEventListener) {
  navigator.xr.addEventListener("devicechange", updateEnterARAvailability);
}

/**
 * 페이지 진입 시점에 한 번 초기 상태를 세팅해준다.
 */
updateEnterARAvailability();
updateDimensionReadout();
preloadVariantTextures();

// TODO: 필요 시 향후 GA 이벤트/로그 연동을 위한 추적 포인트 삽입 (현재는 콘솔 로그만 사용).
