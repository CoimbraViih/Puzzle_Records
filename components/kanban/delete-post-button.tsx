"use client";

import { useActionState } from "react";

import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { deletePost, type PostFormState } from "@/lib/posts/actions";

const initialState: PostFormState = undefined;

export function DeletePostButton({ postId }: { postId: string }) {
  const [state, formAction, pending] = useActionState(
    deletePost,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="post_id" value={postId} />
      <ConfirmSubmitButton
        variant="ghost"
        size="sm"
        disabled={pending}
        confirmMessage="Excluir este post? Essa ação não pode ser desfeita."
      >
        {pending ? "Excluindo..." : "Excluir"}
      </ConfirmSubmitButton>
      {state?.error && (
        <p className="text-xs text-destructive">{state.error}</p>
      )}
    </form>
  );
}
