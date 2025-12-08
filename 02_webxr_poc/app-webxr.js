// WebXR + 2D Plan debug viewer
// b1 / b2 선택 UI + 중앙 레티클 기준으로 SET

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("renderCanvas");
  const engine = new BABYLON.Engine(canvas, true);

  const uiHit   = document.getElementById("ui-hit");
  const uiB1    = document.getElementById("ui-b1");
  const uiB2    = document.getElementById("ui-b2");
  const uiAlign = document.getElementById("ui-align");

  const pointSelect = document.getElementById("pointSelect");
  const btnSet      = document.getElementById("btnSet");

  let latestHit = null;  // 마지막 HitTest 위치 (중앙 레티클 위치)
  let b1 = null;         // 기준점 1 (현실)
  let b2 = null;         // 기준점 2 (현실)

  const createScene = async () => {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.13, 0.14, 0.22, 1.0);

    // ------------------------------------------------------
    // 기본 카메라 / 조명 (PC 디버깅용)
    // ------------------------------------------------------
    const camera = new BABYLON.ArcRotateCamera(
      "cam",
      BABYLON.Tools.ToRadians(-60),
      BABYLON.Tools.ToRadians(70),
      30,
      BABYLON.Vector3.Zero(),
      scene
    );
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 50;
    camera.lowerRadiusLimit = 2;
    camera.upperRadiusLimit = 200;

    const light = new BABYLON.HemisphericLight(
      "hemi",
      new BABYLON.Vector3(0, 1, 0),
      scene
    );
    light.intensity = 0.9;

    // ------------------------------------------------------
    // 바닥 (디버그용) + Hit 표시용 3D 레티클
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

    // 중앙 레이에서 맞닿은 위치를 보여주는 마커(레티클)
    const hitMarker = BABYLON.MeshBuilder.CreateDisc(
      "hitMarker",
      { radius: 0.15, tessellation: 32 },
      scene
    );
    hitMarker.rotation.x = Math.PI / 2;
    const hitMat = new BABYLON.StandardMaterial("hitMat", scene);
    hitMat.diffuseColor = new BABYLON.Color3(1, 0.3, 0.1);
    hitMarker.material = hitMat;
    hitMarker.isVisible = false;

    // ------------------------------------------------------
    // 2D 도면 로드 (Office_2.json)
    //   예상 포맷: { "lines": [ [x1,y1,x2,y2], ... ] }
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
            lines.push([
              new BABYLON.Vector3(x1, 0, y1),
              new BABYLON.Vector3(x2, 0, y2)
            ]);
            minX = Math.min(minX, x1, x2);
            maxX = Math.max(maxX, x1, x2);
            minY = Math.min(minY, y1, y2);
            maxY = Math.max(maxY, y1, y2);
          }
        } else {
          console.warn("Office_2.json 형식이 예상과 다릅니다:", data);
        }

        if (lines.length > 0) {
          const planMesh = BABYLON.MeshBuilder.CreateLineSystem(
            "planLines",
            { lines, updatable: false },
            scene
          );
          planMesh.color = new BABYLON.Color3(1, 1, 1);
          planMesh.parent = planRoot;

          // 도면 중심을 원점으로 이동
          const centerX = (minX + maxX) * 0.5;
          const centerY = (minY + maxY) * 0.5;
          planRoot.position = new BABYLON.Vector3(-centerX, 0, -centerY);
        }
      } catch (err) {
        console.error("Office_2.json 로드 실패:", err);
      }
    }

    await loadPlan();

    // 도면 위 임의의 파란 영역 (이전 POC와 비슷하게)
    const area = BABYLON.MeshBuilder.CreateGround(
      "area",
      { width: 4, height: 4 },
      scene
    );
    const areaMat = new BABYLON.StandardMaterial("areaMat", scene);
    areaMat.diffuseColor = new BABYLON.Color3(0.1, 0.5, 1.0);
    areaMat.alpha = 0.9;
    area.material = areaMat;
    area.position = new BABYLON.Vector3(6, 0.01, 4);
    area.parent = planRoot;

    // ------------------------------------------------------
    // WebXR + HitTest (실기기에서 동작)
    // PC DevTools에선 WebXR Emulator + Polyfill로 확인
    // ------------------------------------------------------
    let xrHelper = null;
    try {
      xrHelper = await scene.createDefaultXRExperienceAsync({
        uiOptions: { sessionMode: "immersive-ar", referenceSpaceType: "local-floor" },
        optionalFeatures: true
      });

      const featuresManager = xrHelper.baseExperience.featuresManager;
      const hitTest = featuresManager.enableFeature(
        BABYLON.WebXRFeatureName.HIT_TEST,
        "latest",
        {
          xrInput: xrHelper.input,
          offsetRay: new BABYLON.Ray(
            new BABYLON.Vector3(0, 0, 0),
            new BABYLON.Vector3(0, 0, 1) // 카메라 앞 방향
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

          latestHit = hit.position.clone(); // 중앙 레티클 위치
          uiHit.textContent =
            `(${latestHit.x.toFixed(3)}, ` +
            `${latestHit.y.toFixed(3)}, ` +
            `${latestHit.z.toFixed(3)})`;

          console.log("Hit pos:", latestHit);
        }
      });
    } catch (e) {
      console.warn(
        "WebXR 초기화 실패 (PC 디버그 전용일 수 있습니다):",
        e
      );
    }

    // ------------------------------------------------------
    // b1 / b2 set + 정합 계산
    // ------------------------------------------------------
    function vecToText(v) {
      if (!v) return "-";
      return `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
    }

    function updateAlignResult() {
      if (!b1 || !b2) {
        uiAlign.textContent = "b1, b2 둘 다 설정 필요";
        return;
      }

      // 현실 좌표에서 b1-b2 벡터
      const diff = b2.subtract(b1);
      const dist = diff.length();

      // 테스트용: 도면 기준 a1=(0,0,0), a2=(dist,0,0) 로 가정
      const scale = 1; // 거리로 스케일링 등은 후속 단계에서 조정
      const yawRad = Math.atan2(diff.z, diff.x);
      const yawDeg = BABYLON.Tools.ToDegrees(yawRad);
      const translation = b1.clone(); // a1을 원점으로 가정했기 때문에

      const msg =
        `dist=${dist.toFixed(3)}, ` +
        `scale=${scale.toFixed(3)}, ` +
        `yaw=${yawDeg.toFixed(2)}°, ` +
        `t=(${translation.x.toFixed(3)}, ` +
        `${translation.y.toFixed(3)}, ` +
        `${translation.z.toFixed(3)})`;

      uiAlign.textContent = msg;

      console.log("== Align Result ==");
      console.log("a1,a2는 테스트용으로 (0,0,0) / (dist,0,0) 가정");
      console.log("b1:", b1);
      console.log("b2:", b2);
      console.log("dist:", dist);
      console.log("scale:", scale);
      console.log("yaw deg:", yawDeg);
      console.log("translation:", translation);
    }

    // UI '선택' 버튼: 현재 Hit를 선택된 기준점(b1/b2)에 기록
    btnSet.addEventListener("click", () => {
      if (!latestHit) {
        console.warn("현재 Hit 정보가 없습니다. (레티클이 평면에 닿지 않음)");
        return;
      }

      const target = pointSelect.value;
      if (target === "b1") {
        b1 = latestHit.clone();
        uiB1.textContent = vecToText(b1);
        console.log("b1 SET (UI):", b1);
      } else if (target === "b2") {
        b2 = latestHit.clone();
        uiB2.textContent = vecToText(b2);
        console.log("b2 SET (UI):", b2);
      }

      updateAlignResult();
    });

    // 키보드 1,2,3도 그대로 남겨두면 편해서 추가 (PC 디버그용)
    window.addEventListener("keydown", (ev) => {
      if (ev.target && ev.target.tagName === "INPUT") return;

      if (ev.key === "1") {
        if (!latestHit) return;
        b1 = latestHit.clone();
        uiB1.textContent = vecToText(b1);
        console.log("b1 SET (key 1):", b1);
        updateAlignResult();
      } else if (ev.key === "2") {
        if (!latestHit) return;
        b2 = latestHit.clone();
        uiB2.textContent = vecToText(b2);
        console.log("b2 SET (key 2):", b2);
        updateAlignResult();
      } else if (ev.key === "3") {
        updateAlignResult();
      }
    });

    return scene;
  };

  createScene().then((scene) => {
    engine.runRenderLoop(() => {
      scene.render();
    });
  });

  window.addEventListener("resize", () => {
    engine.resize();
  });
});
