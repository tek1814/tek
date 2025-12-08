// WebXR + 2D Plan debug viewer
// a1,a2 기준점 포함 + b1,b2 정합 테스트 + 시각화 포함

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("renderCanvas");
  const engine = new BABYLON.Engine(canvas, true);

  // UI 요소 참조
  const uiHit   = document.getElementById("ui-hit");
  const uiB1    = document.getElementById("ui-b1");
  const uiB2    = document.getElementById("ui-b2");
  const uiAlign = document.getElementById("ui-align");
  const pointSelect = document.getElementById("pointSelect");
  const btnSet      = document.getElementById("btnSet");

  // 도면 기준점 a1,a2 (단위: m)
  // A1 = (1500 mm, 0 mm) → (1.5 m, 0 m)
  // A2 = (0 mm, 0 mm) → (0 m, 0 m)
  const a1 = new BABYLON.Vector3(1.5, 0, 0);
  const a2 = new BABYLON.Vector3(0, 0, 0);

  let latestHit = null;  // 레티클(중앙 히트) 위치
  let b1 = null;         // 현실 기준점 1
  let b2 = null;         // 현실 기준점 2

  const createScene = async () => {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.13, 0.14, 0.22, 1.0);

    // ------------------------------------------------------
    // 카메라 / 조명 (PC 디버깅용)
    // ------------------------------------------------------
    const camera = new BABYLON.ArcRotateCamera(
      "cam",
      BABYLON.Tools.ToRadians(-60),
      BABYLON.Tools.ToRadians(70),
      20,
      BABYLON.Vector3.Zero(),
      scene
    );
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 100;

    const light = new BABYLON.HemisphericLight(
      "hemi",
      new BABYLON.Vector3(0, 1, 0),
      scene
    );
    light.intensity = 0.9;

    // ------------------------------------------------------
    // 디버그용 바닥
    // ------------------------------------------------------
    const debugFloor = BABYLON.MeshBuilder.CreateGround(
      "debugFloor",
      { width: 20, height: 20 },
      scene
    );
    const floorMat = new BABYLON.StandardMaterial("floorMat", scene);
    floorMat.diffuseColor = new BABYLON.Color3(0.2, 0.5, 0.2);
    floorMat.alpha = 0.35;
    debugFloor.material = floorMat;

    // ------------------------------------------------------
    // HitMarker (레티클 위치 표시)
    // ------------------------------------------------------
    const hitMarker = BABYLON.MeshBuilder.CreateDisc(
      "hitMarker",
      { radius: 0.12, tessellation: 32 },
      scene
    );
    hitMarker.rotation.x = Math.PI / 2;

    const hitMat = new BABYLON.StandardMaterial("hitMat", scene);
    hitMat.diffuseColor = new BABYLON.Color3(1, 0.3, 0.1);
    hitMarker.material = hitMat;
    hitMarker.isVisible = false;

    // ------------------------------------------------------
    // 도면 로드
    // ------------------------------------------------------
    const planRoot = new BABYLON.TransformNode("planRoot", scene);

    async function loadPlan() {
      try {
        const res = await fetch("Office_2.json");
        const data = await res.json();

        const lines = [];
        let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity;

        if (Array.isArray(data.lines)) {
          for (const seg of data.lines) {
            const [x1, y1, x2, y2] = seg;
            const p1 = new BABYLON.Vector3(x1 * 0.001, 0, y1 * 0.001);
            const p2 = new BABYLON.Vector3(x2 * 0.001, 0, y2 * 0.001);

            lines.push([p1, p2]);

            minX = Math.min(minX, x1, x2);
            maxX = Math.max(maxX, x1, x2);
            minY = Math.min(minY, y1, y2);
            maxY = Math.max(maxY, y1, y2);
          }
        }

        const plan = BABYLON.MeshBuilder.CreateLineSystem(
          "planLines",
          { lines },
          scene
        );
        plan.color = new BABYLON.Color3(1, 1, 1);
        plan.parent = planRoot;

        // 중심 맞추기
        const cx = ((minX + maxX) / 2) * 0.001;
        const cy = ((minY + maxY) / 2) * 0.001;
        planRoot.position = new BABYLON.Vector3(-cx, 0, -cy);

      } catch (e) {
        console.error("도면 로드 실패:", e);
      }
    }

    await loadPlan();

    // ------------------------------------------------------
    // a1, a2 시각화 (PC에서 확인 가능)
    // ------------------------------------------------------
    const sphereA1 = BABYLON.MeshBuilder.CreateSphere("A1", { diameter: 0.12 }, scene);
    sphereA1.position = a1;
    sphereA1.material = new BABYLON.StandardMaterial("matA1", scene);
    sphereA1.material.diffuseColor = new BABYLON.Color3(1, 0, 0); // 빨강
    sphereA1.parent = planRoot;

    const sphereA2 = BABYLON.MeshBuilder.CreateSphere("A2", { diameter: 0.12 }, scene);
    sphereA2.position = a2;
    sphereA2.material = new BABYLON.StandardMaterial("matA2", scene);
    sphereA2.material.diffuseColor = new BABYLON.Color3(0, 1, 0); // 초록
    sphereA2.parent = planRoot;

    // ------------------------------------------------------
    // WebXR HitTest 설정 (실기기용)
    // ------------------------------------------------------
    let xrHelper = null;
    try {
      xrHelper = await scene.createDefaultXRExperienceAsync({
        uiOptions: { sessionMode: "immersive-ar", referenceSpaceType: "local-floor" },
        optionalFeatures: true
      });

      const fm = xrHelper.baseExperience.featuresManager;
      const hitTest = fm.enableFeature(
        BABYLON.WebXRFeatureName.HIT_TEST,
        "latest",
        {
          xrInput: xrHelper.input,
          offsetRay: new BABYLON.Ray(
            new BABYLON.Vector3(0, 0, 0),
            new BABYLON.Vector3(0, 0, 1)
          )
        }
      );

      hitTest.onHitTestResultObservable.add((results) => {
        if (!results || results.length === 0) {
          hitMarker.isVisible = false;
          latestHit = null;
          uiHit.textContent = "-";
          return;
        }

        const hit = results[0];
        if (hit.position) {
          hitMarker.position.copyFrom(hit.position);
          hitMarker.isVisible = true;

          latestHit = hit.position.clone();
          uiHit.textContent =
            `(${latestHit.x.toFixed(3)}, ${latestHit.y.toFixed(3)}, ${latestHit.z.toFixed(3)})`;
        }
      });
    } catch (err) {
      console.warn("WebXR 초기화 실패(PC에서는 정상):", err);
    }

    // ------------------------------------------------------
    // 정합 계산 함수
    // ------------------------------------------------------
    function computeAlign(a1, a2, b1, b2) {
      const va = new BABYLON.Vector2(a2.x - a1.x, a2.z - a1.z);
      const vb = new BABYLON.Vector2(b2.x - b1.x, b2.z - b1.z);

      const lenA = va.length();
      const lenB = vb.length();
      if (lenA < 1e-6 || lenB < 1e-6) return null;

      const scale = lenB / lenA;

      const angleA = Math.atan2(va.y, va.x);
      const angleB = Math.atan2(vb.y, vb.x);
      const yaw = angleB - angleA;

      const sA1 = a1.scale(scale);
      const r = BABYLON.Matrix.RotationYawPitchRoll(yaw, 0, 0);
      const a1Rot = BABYLON.Vector3.TransformCoordinates(sA1, r);

      const translation = b1.subtract(a1Rot);

      return { scale, yaw, translation };
    }

    // ------------------------------------------------------
    // b1/b2 저장 및 정합 적용
    // ------------------------------------------------------
    function setPoint(target) {
      if (!latestHit) {
        console.warn("Hit 정보 없음");
        return;
      }

      if (target === "b1") {
        b1 = latestHit.clone();
        uiB1.textContent = vec(b1);
      } else {
        b2 = latestHit.clone();
        uiB2.textContent = vec(b2);
      }

      if (b1 && b2) applyAlign();
    }

    function vec(v) {
      return `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
    }

    function applyAlign() {
      const result = computeAlign(a1, a2, b1, b2);
      if (!result) return;

      const { scale, yaw, translation } = result;

      planRoot.scaling = new BABYLON.Vector3(scale, 1, scale);
      planRoot.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(0, yaw, 0);
      planRoot.position = translation;

      uiAlign.textContent =
        `scale=${scale.toFixed(3)}, yaw=${(yaw * 180/Math.PI).toFixed(1)}°, pos=${vec(translation)}`;
    }

    btnSet.addEventListener("click", () => {
      setPoint(pointSelect.value);
    });

    return scene;
  };

  createScene().then((scene) => {
    engine.runRenderLoop(() => scene.render());
  });

  window.addEventListener("resize", () => engine.resize());
});
