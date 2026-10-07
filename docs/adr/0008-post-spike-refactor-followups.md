# 스파이크 이행 뒤에 예정된 리팩터링

스파이크(`spike/owner-controls-and-route-inference`)를 실 구현으로 옮기는 작업은 확정된 동작을 우선 이전한다. 이 문서는 이전 자체가 아니라 그 뒤에 남는 정리 작업을 한데 기록한다. 각 항목의 스파이크에 없는 코드·변경 사항은 `feat/owner-controls-and-route-inference` 브랜치의 아티팩트 미리보기와 설계 합의를 참조한다.

## 항목

1. **엣지와 엣지 라벨의 통합** — 간선 표시를 담당하는 컴포넌트가 종류별로 늘어나는 대신, 공통 표시 컴포넌트가 표현 스펙(경로·마커·라벨 앵커 슬롯)을 다양하게 열고 각 그래프의 데이터를 이 스펙으로 옮기는 변환 함수를 여러 벌 두는 구조로 바꾼다. 라벨 몸체도 독립 컴포넌트가 아니라 라벨 슬롯(요구 칩 조합 포함)으로 흡수한다. 라벨 컴포넌트의 이름은 `*EdgeLabel`로 끝난다. 이 합의로 스파이크의 `route-condition-label.tsx`는 `guard-edge-label.tsx`(`GuardEdgeLabel`)로 이름이 정해졌다(`feat/…` 참조 — 스파이크에는 없는 이름). 스펙이 만능 슬롯으로 비대해지면 표현 계약(경로·마커·라벨 배치)을 벗어나는 신호이므로 그때 분리를 다시 검토한다.
2. **[ADR 0007](0007-separate-graph-types-from-presentation-components.md) 후속 정리** — 저장용 스키마, 내부 투영·렌더 모델, 표시 컴포넌트의 결합을 푼다. 결정 노드 투영은 저장용 스키마를 확장하지 않는 내부 모델로 옮기고, `MessageEdge`와 `RouteEdge`의 경로·라벨 계산과 표시 책임을 검토해 공통화할 경계를 정한다.
3. **[ADR 0003](0003-layout-renderer-one-to-one-contract.md) 이행** — 렌더러 선택을 그래프 종류 축에서 `layout.id` 축으로 옮기고 레이아웃과 렌더러를 1:1로 대응시킨다. 컴포넌트 구조 전용 레이아웃(`component-structure`) 신설과 ELK 실행 코어 분리가 이 작업의 일부다.
4. **결정 노드 투영 모듈의 위치** — 컴포넌트 구조 다이어그램 전용 계약을 범용 위치(`features/diagram` 최상위의 `decision-nodes.ts`)에 두지 않고, 컴포넌트 구조 네임스페이스로 옮긴다. 결정 노드 표시 컴포넌트(`shared/react-flow`의 다이아몬드 파츠)는 범용으로 유지한다. 레이아웃·렌더러 전반이 재배치될 예정이므로 그때 함께 처리한다.
5. **[ADR 0004](0004-jsdom-route-label-click-gap.md) 후속** — 시뮬레이션 DOM 통합 테스트에서 조합식 라벨 클릭이 React 핸들러에 닿지 않는 원인을 규명하고 통합 테스트 시나리오를 복원한다. 해당 문서의 "jsdom" 표기는 실제 환경인 happy-dom으로 정정한다.
6. **노드 호버 보고 통로 재검** — `card-node.tsx`의 `onHoverChange` 폐지는 [ADR 0006](0006-edge-hover-channel.md)의 보류 사항이다. 노드 주체의 점등 덮어쓰기가 필요해질 때 이 통로를 다시 논의한다.

## 실 구현에서 이미 정해진 사항 (스파이크와 다른 점)

- diff 카드는 독립 위젯이 아니라 컴포넌트 구조 렌더러가 React Flow `Panel` 안에 인라인으로 렌더한다(스파이크의 `component-structure-route-diff-card.tsx`는 폐기). 위치는 ADR 0002의 우측 하단 고정을 유지한다.
- 조건부 필드의 스위치는 shadcn `Switch`를 쓰고, 스파이크의 `toggle-variants.ts` 분리는 폐기한다.
- 저장용 엣지 타입 `control`·`graph.additional`·레이아웃별 멤버 유니온 재구성은 실 구현 설계 합의로, 스파이크의 그래프 확장(`controls`·`roots`·`guards`·`sourcePort` 저장)을 대체한다. 상세는 `feat/owner-controls-and-route-inference`의 아티팩트 미리보기와 설계 기록을 따른다.
