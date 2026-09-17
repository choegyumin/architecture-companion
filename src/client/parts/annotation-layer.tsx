import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  getAnnotationComposerPlacement,
  getAnnotationComposerPoint,
} from "@/client/parts/annotation-layer.composer-placement";
import { useAnnotationPinDrag } from "@/client/parts/annotation-layer.pin-drag";
import type { Annotation, AnnotationAnchor, AnnotationDocument } from "@/features/annotation/annotation-document";
import type { AnnotationDraft } from "@/features/annotation/create-annotation-draft";
import { Button } from "@/shared/react-ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/shared/react-ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/shared/react-ui/field";
import { Form } from "@/shared/react-ui/form";
import { Textarea } from "@/shared/react-ui/textarea";

export type AnnotationSurface = Readonly<{
  canvasId: string;
}>;

export type AnnotationEdit = Readonly<{
  body: string;
  conflict?: Readonly<{ kind: "changed"; external: Annotation }> | Readonly<{ kind: "deleted" }>;
  source: Annotation;
  annotationId: string;
}>;

export type AnnotationEditConflictResolution = "discard-local" | "keep-local" | "restore-local" | "use-external";

export type AnnotationReviewController = Readonly<{
  document: AnnotationDocument;
  draft?: AnnotationDraft;
  edit?: AnnotationEdit;
  editError?: string;
  error?: string;
  isCommentMode: boolean;
  isManaging: boolean;
  isPublishing: boolean;
  begin: (anchor: AnnotationAnchor) => void;
  change: (body: string) => void;
  changeEdit: (body: string) => void;
  cancel: () => Promise<boolean>;
  closeEdit: () => Promise<boolean>;
  move: (annotationId: string, point: AnnotationAnchor["point"]) => Promise<void>;
  open: (annotationId: string) => void;
  publish: () => Promise<void>;
  removeEdit: () => Promise<void>;
  resolveEditConflict: (resolution: AnnotationEditConflictResolution) => Promise<void>;
  saveEdit: () => Promise<boolean>;
}>;

export type AnnotationCanvasController = AnnotationReviewController &
  Readonly<{
    surface: AnnotationSurface;
  }>;

function isOnSurface(anchor: AnnotationAnchor, surface: AnnotationSurface): boolean {
  return anchor.canvasId === surface.canvasId;
}

function getSurfaceAnnotations(document: AnnotationDocument, surface: AnnotationSurface): readonly Annotation[] {
  return document.annotations.filter((annotation) => isOnSurface(annotation.anchor, surface));
}

function getSurfaceDraft(controller: AnnotationCanvasController): AnnotationDraft | undefined {
  return controller.draft && isOnSurface(controller.draft.anchor, controller.surface) ? controller.draft : undefined;
}

type Point = AnnotationAnchor["point"];
type Size = Readonly<{ height: number; width: number }>;

function pointStyle(point: Point): CSSProperties {
  return { left: point.x, top: point.y };
}

function stopCanvasClick(event: MouseEvent<HTMLElement>): void {
  event.stopPropagation();
}

function closeOnEscape(event: KeyboardEvent<HTMLFormElement>, close: () => Promise<boolean>): void {
  if (event.key !== "Escape") return;

  event.preventDefault();
  void close();
}

type AnnotationLayerProps = Readonly<{
  bounds: Size;
  canvasToScreenPoint: (point: Point) => Point;
  controller: AnnotationCanvasController;
  screenToCanvasPoint: (point: Point) => Point;
}>;

export function AnnotationLayer({
  bounds,
  canvasToScreenPoint,
  controller,
  screenToCanvasPoint,
}: AnnotationLayerProps) {
  const [composerSize, setComposerSize] = useState<Size>({ height: 0, width: 288 });
  const composer = useRef<HTMLFormElement | null>(null);
  const selectedPin = useRef<HTMLButtonElement | null>(null);
  const { cancelDrag, continueDrag, drag, finishDrag, openAnnotation, startDrag } = useAnnotationPinDrag({
    disabled: controller.isManaging,
    move: controller.move,
    open: controller.open,
    screenToCanvasPoint,
  });
  const annotations = getSurfaceAnnotations(controller.document, controller.surface);
  const draft = getSurfaceDraft(controller);
  const editedAnnotation = controller.edit
    ? (annotations.find((annotation) => annotation.id === controller.edit?.annotationId) ?? controller.edit.source)
    : undefined;
  const panelPoint = draft?.anchor.point ?? editedAnnotation?.anchor.point;
  const composerPlacement = panelPoint
    ? getAnnotationComposerPlacement(canvasToScreenPoint(panelPoint), bounds)
    : "bottom-right";
  const editConflictMessage =
    controller.edit?.conflict?.kind === "changed"
      ? "Comment changed outside the app."
      : controller.edit?.conflict?.kind === "deleted"
        ? "Comment was deleted outside the app."
        : undefined;

  useLayoutEffect(() => {
    const rect = composer.current?.getBoundingClientRect();
    if (!rect || (rect.width === composerSize.width && rect.height === composerSize.height)) return;
    setComposerSize({ height: rect.height, width: rect.width });
  }, [
    composerSize.height,
    composerSize.width,
    controller.draft?.body,
    controller.edit?.body,
    controller.edit?.conflict?.kind,
    controller.edit?.annotationId,
    controller.editError,
    controller.error,
    controller.isManaging,
    controller.isPublishing,
  ]);

  function submitDraft(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void controller.publish();
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const returnTarget = selectedPin.current;
    if (await controller.saveEdit()) returnTarget?.focus();
  }

  async function closeEdit(): Promise<void> {
    const returnTarget = selectedPin.current;
    if (await controller.closeEdit()) globalThis.queueMicrotask(() => returnTarget?.focus());
  }

  return (
    <>
      {annotations.map((annotation, index) => {
        const point = drag?.annotationId === annotation.id ? drag.point : annotation.anchor.point;
        const body = annotation.comment.body;

        return (
          <button
            aria-label={`Comment: ${body}`}
            className="pointer-events-auto absolute grid size-7 -translate-1/2 touch-none place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            data-comment-ui
            disabled={controller.isManaging && drag?.annotationId !== annotation.id}
            key={annotation.id}
            onClick={(event) => openAnnotation(event, annotation.id)}
            onPointerCancel={(event) => cancelDrag(event, annotation.id)}
            onPointerDown={(event) => startDrag(event, annotation.id, annotation.anchor.point)}
            onPointerMove={(event) => continueDrag(event, annotation.id)}
            onPointerUp={(event) => finishDrag(event, annotation.id)}
            ref={controller.edit?.annotationId === annotation.id ? selectedPin : undefined}
            style={pointStyle(canvasToScreenPoint(point))}
            type="button"
          >
            {index + 1}
          </button>
        );
      })}

      {editedAnnotation && controller.edit ? (
        <Form
          aria-label="Edit comment"
          className="pointer-events-auto absolute w-72"
          data-comment-ui
          onClick={stopCanvasClick}
          onKeyDown={(event) => closeOnEscape(event, controller.closeEdit)}
          onSubmit={(event) => void submitEdit(event)}
          ref={composer}
          style={pointStyle(
            getAnnotationComposerPoint(
              canvasToScreenPoint(editedAnnotation.anchor.point),
              composerPlacement,
              composerSize,
              bounds,
            ),
          )}
        >
          <Card size="sm">
            <CardHeader>
              <CardTitle>Edit comment</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field data-invalid={controller.editError || editConflictMessage ? true : undefined}>
                  <FieldLabel className="sr-only" htmlFor="spatial-comment-edit-body">
                    Comment text
                  </FieldLabel>
                  <Textarea
                    aria-invalid={controller.editError || editConflictMessage ? true : undefined}
                    autoFocus
                    id="spatial-comment-edit-body"
                    onChange={(event) => controller.changeEdit(event.currentTarget.value)}
                    value={controller.edit.body}
                  />
                  {controller.editError ? <FieldError>{controller.editError}</FieldError> : null}
                  {editConflictMessage ? <FieldError>{editConflictMessage}</FieldError> : null}
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-between gap-2">
              {controller.edit.conflict?.kind === "changed" ? (
                <>
                  <Button
                    disabled={controller.isManaging}
                    onClick={() => void controller.resolveEditConflict("use-external")}
                    type="button"
                    variant="outline"
                  >
                    Use external
                  </Button>
                  <Button
                    disabled={controller.isManaging}
                    onClick={() => void controller.resolveEditConflict("keep-local")}
                    type="button"
                  >
                    Keep mine
                  </Button>
                </>
              ) : controller.edit.conflict?.kind === "deleted" ? (
                <>
                  <Button
                    disabled={controller.isManaging}
                    onClick={() => void controller.resolveEditConflict("discard-local")}
                    type="button"
                    variant="destructive"
                  >
                    Discard
                  </Button>
                  <Button
                    disabled={controller.isManaging}
                    onClick={() => void controller.resolveEditConflict("restore-local")}
                    type="button"
                  >
                    {controller.isManaging ? "Restoring…" : "Restore"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    disabled={controller.isManaging}
                    onClick={() => void controller.removeEdit()}
                    type="button"
                    variant="destructive"
                  >
                    Delete
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      disabled={controller.isManaging}
                      onClick={() => void closeEdit()}
                      type="button"
                      variant="ghost"
                    >
                      Cancel
                    </Button>
                    <Button disabled={controller.isManaging || controller.edit.body.trim().length === 0} type="submit">
                      {controller.isManaging ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </>
              )}
            </CardFooter>
          </Card>
        </Form>
      ) : null}

      {draft ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute grid size-7 -translate-1/2 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow-sm"
            style={pointStyle(canvasToScreenPoint(draft.anchor.point))}
          >
            {annotations.length + 1}
          </div>
          <Form
            aria-label="Add comment"
            className="pointer-events-auto absolute w-72"
            data-comment-ui
            onClick={stopCanvasClick}
            onKeyDown={(event) => closeOnEscape(event, controller.cancel)}
            onSubmit={submitDraft}
            ref={composer}
            style={pointStyle(
              getAnnotationComposerPoint(
                canvasToScreenPoint(draft.anchor.point),
                composerPlacement,
                composerSize,
                bounds,
              ),
            )}
          >
            <Card size="sm">
              <CardHeader>
                <CardTitle>Add comment</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field data-invalid={controller.error ? true : undefined}>
                    <FieldLabel className="sr-only" htmlFor="spatial-comment-body">
                      Comment text
                    </FieldLabel>
                    <Textarea
                      aria-invalid={controller.error ? true : undefined}
                      autoFocus
                      id="spatial-comment-body"
                      onChange={(event) => controller.change(event.currentTarget.value)}
                      placeholder="Leave feedback"
                      value={draft.body}
                    />
                    {controller.error ? <FieldError>{controller.error}</FieldError> : null}
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="justify-end gap-2">
                <Button
                  disabled={controller.isPublishing}
                  onClick={() => void controller.cancel()}
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button disabled={controller.isPublishing || draft.body.trim().length === 0} type="submit">
                  {controller.isPublishing ? "Posting…" : "Post"}
                </Button>
              </CardFooter>
            </Card>
          </Form>
        </>
      ) : null}
    </>
  );
}
