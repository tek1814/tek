window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("renderCanvas");
  const engine = new BABYLON.Engine(canvas, true);

  const createScene = async () => {
    const scene = new BABYLON.Scene(engine);

    // =====================================================
    // b1, b2 저장 변수 (AR에서 찍은 두 기준점)
    // =====================================================
    let b1 = null;
    let b2 = null;

    // =====================================================
    // 기본 카메라 / 조명 (AR 아니어도 화면 보이도록)
    // =====================================================
    const camera = new BABYLON.ArcRotateCamera(
      "camera",
      Math.PI / 2,
      Math.PI / 3,
      8,
      new BABYLON.Vector3(0, 1, 0),
      scene
    );
    camera.attachControl(canvas, true);

    const light = new BABYLON.HemisphericLight(
      "light",
      new BABYLON.Vector3(0, 1, 0),
      scene
    );

    // =====================================================
    // 도면 Root (정합될 Transform 부모)
    // =====================================================
    const drawingRoot = new BABYLON.TransformNode("drawingRoot", scene);

    // 테스트용 바닥 Plane (도면 위치 확인용, 나중에 필요 없으면 주석 처리)
    const drawingPlane = BABYLON.MeshBuilder.CreateGround(
      "drawingPlane",
      { width: 2, height: 2 },
      scene
    );
    drawingPlane.parent = drawingRoot;

    const drawingMat = new BABYLON.StandardMaterial("drawingMat", scene);
    drawingMat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 1.0);
    drawingPlane.material = drawingMat;

    // =====================================================
    // Office_2.json 로드해서 라인 도면 생성
    // =====================================================
    async function loadPlan(scene) {
      const scale2d = 0.001; // mm → m 정도라고 가정

      const res = await fetch("Office_2.json");
      const data = await res.json(); // { layers: { ... } }

      const lines = [];

      // data.layers 의 각 레이어 순회
      for (const layerName in data.layers) {
        const entities = data.layers[layerName];
        if (!Array.isArray(entities)) continue;

        for (const ent of entities) {
          if (!ent || ent.type !== "LINE") continue;
          const p1 = ent.start;
          const p2 = ent.end;
          if (!p1 || !p2) continue;

          lines.push([
            new BABYLON.Vector3(p1[0] * scale2d, 0, p1[1] * scale2d),
            new BABYLON.Vector3(p2[0] * scale2d, 0, p2[1] * scale2d),
          ]);
        }
      }

      if (lines.length === 0) {
        console.warn("Office_2.json 에서 LINE 엔티티를 찾지 못했습니다.");
        return;
      }

      const plan = BABYLON.MeshBuilder.CreateLineSystem(
        "planLines",
        { lines: lines },
        scene
      );

      // 도면 전체가 drawingRoot 아래에서 같이 움직이도록 parent 설정
      plan.parent = drawingRoot;
    }

    // =====================================================
    // 도면 좌표계 A1, A2 (도면 기준 두 점: 1m 간격이라고 가정)
    // =====================================================
    const a1 = new BABYLON.Vector2(-0.5, 0.0); // (-0.5, 0)
    const a2 = new BABYLON.Vector2(0.5, 0.0);  // (0.5, 0)

    // 도면 로드
    await loadPlan(scene);

    // =====================================================
    // Hit Marker (HitTest 위치 표시용 빨간 점)
    // =====================================================
    const hitMarker = BABYLON.MeshBuilder.CreateSphere(
      "hitMarker",
      { diameter: 0.2 },
      scene
    );
    const markerMat = new BABYLON.StandardMaterial("markerMat", scene);
    markerMat.emissiveColor = new BABYLON.Color3(1, 0, 0);
    hitMarker.material = markerMat;
    hitMarker.isVisible = false;

    // =====================================================
    // WebXR 시작
    // =====================================================
    const xrHelper = await scene.createDefaultXRExperienceAsync({
      uiOptions: {
        sessionMode: "immersive-ar",
        referenceSpaceType: "local-floor",
      },
      optionalFeatures: true,
    });

    // XR 상태 로그 (디버그용)
    xrHelper.baseExperience.onStateChangedObservable.add((state) => {
      console.log("XR state:", state);
    });

    // =====================================================
    // HitTest 기능 활성화
    // =====================================================
    const featuresManager = xrHelper.baseExperience.featuresManager;
    const hitTest = featuresManager.enableFeature(
      BABYLON.WebXRFeatureName.HIT_TEST,
      "latest",
      {
        xrInput: xrHelper.input,
        offsetRay: new BABYLON.Ray(
          new BABYLON.Vector3(0, 0, 0),
          new BABYLON.Vector3(0, 0, 1)
        ),
      }
    );

    // HitTest 콜백: 평면이 잡히면 hitMarker 위치 업데이트
    hitTest.onHitTestResultObservable.add((results) => {
      if (!results || results.length === 0) {
        hitMarker.isVisible = false;
        return;
      }

      const hit = results[0];

      if (hit.position) {
        hitMarker.position.copyFrom(hit.position);
      }

      hitMarker.isVisible = true;
      console.log("Hit pos:", hitMarker.position);
    });

    // =====================================================
    // A1,A2 ↔ B1,B2 정합 계산 + 도면 Transform 적용
    // =====================================================
    function alignDrawingWithAB() {
      if (!b1 || !b2) {
        console.warn("b1, b2가 설정되지 않았습니다. (키 1, 2 먼저)");
        return;
      }

      // 1) 2D 벡터 계산 (XZ 평면 기준)
      const aVec = a2.subtract(a1); // Vector2
      const bVec = new BABYLON.Vector2(b2.x - b1.x, b2.z - b1.z);

      const lenA = aVec.length();
      const lenB = bVec.length();
      if (lenA === 0 || lenB === 0) {
        console.warn("a1,a2 또는 b1,b2 간 거리가 0입니다.");
        return;
      }

      // 2) 스케일
      const scale = lenB / lenA;

      // 3) yaw 각도 (도면 → AR)
      const angleA = Math.atan2(aVec.y, aVec.x);
      const angleB = Math.atan2(bVec.y, bVec.x);
      const yaw = angleB - angleA;

      // 4) 변환 행렬 계산 (스케일 + 회전)
      const scaleVec = new BABYLON.Vector3(scale, 1, scale);
      const rotQuat = BABYLON.Quaternion.FromEulerAngles(0, yaw, 0);

      const a1_3d = new BABYLON.Vector3(a1.x, 0, a1.y);

      const mNoTrans = BABYLON.Matrix.Compose(
        scaleVec,
        rotQuat,
        BABYLON.Vector3.Zero()
      );
      const a1Transformed = BABYLON.Vector3.TransformCoordinates(
        a1_3d,
        mNoTrans
      );

      // 5) 평행이동: 변환된 a1이 b1에 오도록
      const translation = b1.subtract(a1Transformed);

      // drawingRoot에 최종 Transform 적용
      drawingRoot.scaling = scaleVec;
      drawingRoot.rotation = new BABYLON.Vector3(0, yaw, 0);
      drawingRoot.position = translation;

      console.log("== Align Result ==");
      console.log("scale:", scale);
      console.log("yaw deg:", (yaw * 180 / Math.PI).toFixed(3));
      console.log("translation:", translation);
    }

    // =====================================================
    // 키보드 입력: 1 → b1, 2 → b2, 3 → 정합 실행
    // =====================================================
    window.addEventListener("keydown", (event) => {
      if (event.key === "1") {
        b1 = hitMarker.position.clone();
        console.log("b1 SET:", b1);
      }

      if (event.key === "2") {
        b2 = hitMarker.position.clone();
        console.log("b2 SET:", b2);
      }

      if (event.key === "3") {
        alignDrawingWithAB();
      }
    });

    // =====================================================
    // 렌더 루프
    // =====================================================
    engine.runRenderLoop(() => {
      scene.render();
    });

    window.addEventListener("resize", () => {
      engine.resize();
    });

    return scene;
  };

  createScene();
});
