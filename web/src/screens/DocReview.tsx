import { Button, Card } from "../ui"

/**
 * Pantalla de REVISIÓN POR LADO (nueva, estilo Didit): tras capturar un lado
 * mostramos la foto y preguntamos "¿Se ve bien?" con Confirmar / Volver a tomar.
 * Esto reemplaza el auto-avance anterior — el usuario valida cada lado.
 *
 * No toca el backend: la imagen vive en estado del cliente (dataURL); recién al
 * confirmar AMBOS lados se sube (POST /document {front, back}).
 */
export function DocReview({
  side,
  image,
  onConfirm,
  onRetake,
}: {
  side: "front" | "back"
  image: string
  onConfirm: () => void
  onRetake: () => void
}) {
  const isFront = side === "front"
  return (
    <Card>
      <div className="teko-slide-in flex flex-col">
        <h1 className="text-xl font-bold text-gray-900">
          {isFront ? "Revisá el frente" : "Revisá el dorso"}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          ¿Se ve nítido y completo, sin reflejos? Si está bien, confirmá.
        </p>

        <div className="my-5 overflow-hidden rounded-3xl bg-gray-900 ring-1 ring-gray-200">
          <img
            src={image}
            alt={`Cédula ${isFront ? "frente" : "dorso"}`}
            className="aspect-[1.586/1] w-full object-cover"
          />
        </div>

        <div className="flex flex-col gap-2.5">
          <Button onClick={onConfirm}>Confirmar</Button>
          <Button variant="ghost" onClick={onRetake}>
            Volver a tomar
          </Button>
        </div>
      </div>
    </Card>
  )
}
