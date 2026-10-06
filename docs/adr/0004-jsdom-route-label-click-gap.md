# jsdom 통합 테스트에서 조합식 라벨 클릭 미작동 — 단위 테스트로 위임

`spike/owner-controls-and-route-inference` 스파이크에서 조합식 라벨(간선 활성 조건을 담은 버튼)의 클릭이
jsdom 통합 테스트 환경에서만 React onClick 핸들러에 도달하지 않는다. 브라우저(개발 서버 실측)에서는 클릭 역산이
정상 동작하고, `attachGuardLabels`가 만든 라벨을 직접 렌더하는 단위 테스트(`component-structure-guards.test.tsx`)에서도
클릭이 동작한다. 통합 렌더러(`DiagramRenderer` 전체)를 거친 경우에만 발생하며, `userEvent.click`과 `fireEvent.click`
모두 무효였고 hover 라벨의 mouseenter 리렌더와도 무관함을 확인했다(`pointer: mouse 비활성화로도 재현).

## 결정

원인 규명을 스파이크 범위 밖으로 미룬다. 당분간 라벨 클릭 상호작용은 단위 테스트가 검증하고,
통합 테스트는 소유 카드 필드(스위치·토글 그룹) 클릭으로 시나리오를 검증한다. 통합 테스트에 라벨 클릭이
없는 것은 의도된 우회이며 회귀가 아니다.

## 실 구현 시 할 일

- 원인 후보: React Flow `EdgeLabelRenderer` 포털과 React 19의 jsdom 이벤트 위임 조합. 라벨이 포털로
  렌더되는 엣지 위젯 계층에서 React 합성 click이 발화하지 않는 것으로 추정되나 미확인.
- 재현 최소화(React Flow + 포털 + 버튼) 후 원인 확정, 통합 테스트에 라벨 클릭 시나리오 복원.
- `component-structure-diagram-renderer.test.tsx`의 "라벨 클릭은 guards 단위 테스트가 담당" 주석 3곳이
  이 위임을 가리킨다 — 복원 시 같이 정리.
