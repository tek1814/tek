async function loadSvgWithAnchors(url) {
  const res = await fetch(url);
  const text = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;

  const A1_el = svg.querySelector("g.A1 > circle, circle.A1");
  const A2_el = svg.querySelector("g.A2 > circle, circle.A2");

  if (!A1_el || !A2_el) {
    console.error("A1/A2 기준점을 찾지 못했습니다.");
    return;
  }

  const A1 = {
    x: parseFloat(A1_el.getAttribute("cx")),
    y: parseFloat(A1_el.getAttribute("cy")),
  };
  const A2 = {
    x: parseFloat(A2_el.getAttribute("cx")),
    y: parseFloat(A2_el.getAttribute("cy")),
  };

  console.log("A1:", A1);
  console.log("A2:", A2);

  window.planAnchors = { A1, A2 };
}

window.addEventListener("load", () => {
  loadSvgWithAnchors("./assets/svg/Office_2.svg");
});
