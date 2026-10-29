import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AddKeyForm } from "@/components/ai/add-key-form";
import { DeleteKeyButton } from "@/components/ai/delete-key-button";
import { listOwnKeys } from "@/lib/ai-keys";
import { requireSession } from "@/lib/dal";

export const metadata = { title: "Your AI key — Study Hub" };

/**
 * "Add your key" (spec section 8): a guided screen in plain steps where each
 * leader adds their own Gemini key — created in their own Google account and
 * project, used only for their own requests. Keys are listed masked (last 4
 * characters only); the ciphertext is never sent to any client.
 */
export default async function AiKeysPage() {
  const session = await requireSession();
  const keys = await listOwnKeys(session.userId);

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">Your AI key</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The AI assistant uses your own Gemini key. You create it in your own
          Google account, and it is used only for your requests.
        </p>
      </div>

      {keys.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your keys</CardTitle>
            <CardDescription>
              Only the last 4 characters are ever shown.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{key.label}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    Project: {key.project_label} · key ends {key.key_last4}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant={
                      key.status === "active"
                        ? "default"
                        : key.status === "cooling"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {key.status === "cooling"
                      ? "Cooling down"
                      : key.status === "disabled"
                        ? "Disabled"
                        : "Active"}
                  </Badge>
                  <DeleteKeyButton keyId={key.id} label={key.label} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a key</CardTitle>
        </CardHeader>
        <CardContent>
          <AddKeyForm />
        </CardContent>
      </Card>
    </div>
  );
}
