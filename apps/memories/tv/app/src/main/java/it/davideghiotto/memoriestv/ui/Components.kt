package it.davideghiotto.memoriestv.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.Glow
import androidx.tv.material3.Icon
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import it.davideghiotto.memoriestv.MemoriesApp
import it.davideghiotto.memoriestv.data.Asset
import it.davideghiotto.memoriestv.data.ImageSize
import it.davideghiotto.memoriestv.data.MediaService
import it.davideghiotto.memoriestv.data.ThumbHash

/** The active service; screens only exist while signed in. */
val service: MediaService get() = MemoriesApp.instance.service.value!!

/**
 * A photo, cropped to fill: placeholder grey, then the thumbhash blur, then the image.
 */
@Composable
fun AssetPicture(
    asset: Asset?,
    modifier: Modifier = Modifier,
    size: ImageSize = ImageSize.Thumbnail,
    contentScale: ContentScale = ContentScale.Crop,
) {
    Box(modifier.background(C.placeholder)) {
        if (asset != null) {
            val hash = remember(asset.thumbhash) { ThumbHash.bitmap(asset.thumbhash)?.asImageBitmap() }
            if (hash != null) {
                Image(hash, null, Modifier.fillMaxSize(), contentScale = contentScale)
            }
            AsyncImage(
                model = service.image(asset.id, size, asset.thumbhash),
                contentDescription = null,
                contentScale = contentScale,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/** Duration bottom-right, heart bottom-left: the iOS grid badges. */
@Composable
fun Badges(asset: Asset, modifier: Modifier = Modifier, compact: Boolean = false) {
    val shadow = TextStyle(shadow = Shadow(Color.Black.copy(alpha = 0.7f), Offset(0f, 1f), 4f))
    Box(modifier.fillMaxSize().padding(if (compact) 4.dp else 6.dp)) {
        asset.durationText?.let {
            Text(it, style = shadow, fontSize = if (compact) 10.sp else 12.sp, fontWeight = FontWeight.SemiBold,
                color = C.label, modifier = Modifier.align(Alignment.BottomEnd))
        }
        if (asset.isFavorite) {
            Icon(Icons.Filled.Favorite, null, tint = C.label,
                modifier = Modifier.align(Alignment.BottomStart).size(if (compact) 11.dp else 14.dp))
        }
    }
}

/**
 * A focusable picture tile: lifts 8% and gets a white ring when focused, the TV's stand-in for a
 * tap target.
 */
@Composable
fun Tile(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(R.cell),
    focusedScale: Float = 1.1f,
    onLongClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Surface(
        onClick = onClick,
        onLongClick = onLongClick,
        modifier = modifier,
        shape = ClickableSurfaceDefaults.shape(shape),
        scale = ClickableSurfaceDefaults.scale(focusedScale = focusedScale),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = C.placeholder, focusedContainerColor = C.placeholder,
            pressedContainerColor = C.placeholder,
        ),
        border = ClickableSurfaceDefaults.border(
            focusedBorder = Border(BorderStroke(3.dp, C.label), shape = shape),
        ),
        glow = ClickableSurfaceDefaults.glow(focusedGlow = Glow(Color.Black.copy(alpha = 0.6f), 18.dp)),
    ) { content() }
}

/**
 * A Liquid-Glass capsule button: translucent dark at rest, white with dark text when focused.
 */
@Composable
fun GlassButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    icon: ImageVector? = null,
    selected: Boolean = false,
    shape: Shape = CircleShape,
    content: (@Composable RowScope.() -> Unit)? = null,
) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = ClickableSurfaceDefaults.shape(shape),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.06f),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (selected) C.label.copy(alpha = 0.18f) else C.glass,
            contentColor = C.label,
            focusedContainerColor = C.label,
            focusedContentColor = C.black,
            pressedContainerColor = C.label.copy(alpha = 0.8f),
            pressedContentColor = C.black,
        ),
        border = ClickableSurfaceDefaults.border(
            border = Border(BorderStroke(0.5.dp, C.hairline), shape = shape),
            focusedBorder = Border.None,
        ),
    ) {
        Row(
            Modifier.height(40.dp).padding(horizontal = if (label == null && content == null) 0.dp else 18.dp)
                .then(if (label == null && content == null) Modifier.width(40.dp) else Modifier),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        ) {
            if (icon != null) Icon(icon, label, modifier = Modifier.size(20.dp))
            if (label != null) Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            content?.invoke(this)
        }
    }
}

/** Static glass, for labels that are not buttons (the viewer's date capsule). */
fun Modifier.glass(shape: Shape = CircleShape) =
    this.clip(shape).background(C.glassStrong).border(0.5.dp, C.hairline, shape)

/** The iOS segmented control: Years · Months · All. */
@Composable
fun <T> Segmented(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.glass().padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEach { (value, label) ->
            Surface(
                onClick = { onSelect(value) },
                shape = ClickableSurfaceDefaults.shape(CircleShape),
                scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
                colors = ClickableSurfaceDefaults.colors(
                    containerColor = if (value == selected) C.label.copy(alpha = 0.16f) else Color.Transparent,
                    contentColor = if (value == selected) C.label else C.label2,
                    focusedContainerColor = C.label,
                    focusedContentColor = C.black,
                ),
            ) {
                Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp))
            }
        }
    }
}

/** "Albums >" — a Collections section title. */
@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, chevron: Boolean = true) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = Type.title)
        if (chevron) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = C.label3, modifier = Modifier.size(26.dp))
    }
}

/** A screen header: large title with an optional subtitle, actions on the right. */
@Composable
fun Header(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = Type.largeTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = Type.subhead, maxLines = 1)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
    }
}

/** A quiet spinner: three dots breathing, no Material ring. */
@Composable
fun Loading(modifier: Modifier = Modifier, label: String? = null) {
    val t = rememberInfiniteTransition(label = "dots")
    val phase by t.animateFloat(0f, 3f, infiniteRepeatable(tween(1200, easing = LinearEasing), RepeatMode.Restart), label = "p")
    Column(modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            repeat(3) { i ->
                val d = ((phase - i + 3) % 3)
                val a = if (d < 1) 1f - d * 0.6f else 0.4f
                Box(Modifier.size(10.dp).alpha(a).background(C.label, CircleShape))
            }
        }
        if (label != null) {
            Spacer(Modifier.height(14.dp))
            Text(label, style = Type.subhead)
        }
    }
}

/** ContentUnavailableView: a symbol, a title, a line, maybe a button. */
@Composable
fun Message(
    title: String,
    detail: String? = null,
    icon: ImageVector? = null,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    Column(
        modifier.fillMaxSize().padding(48.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (icon != null) Icon(icon, null, tint = C.label2, modifier = Modifier.size(44.dp))
        Text(title, style = Type.title)
        if (detail != null) Text(detail, style = Type.body.copy(color = C.label2))
        if (action != null) { Spacer(Modifier.height(8.dp)); action() }
    }
}

/** The live-photo badge: two rings and a dot (no Apple bitmaps). */
@Composable
fun LiveGlyph(modifier: Modifier = Modifier.size(18.dp), color: Color = C.label) {
    Canvas(modifier) {
        val r = size.minDimension / 2
        drawCircle(color, r * 0.28f)
        drawCircle(color, r * 0.6f, style = Stroke(r * 0.13f))
        drawCircle(color, r * 0.92f, style = Stroke(r * 0.1f))
    }
}

/** Pause: two bars (not in material-icons-core). */
@Composable
fun PauseGlyph(modifier: Modifier = Modifier.size(20.dp), color: Color = Color.Unspecified) {
    Canvas(modifier) {
        val c = if (color == Color.Unspecified) Color.White else color
        val w = size.width * 0.26f
        drawRect(c, Offset(size.width * 0.18f, size.height * 0.15f), androidx.compose.ui.geometry.Size(w, size.height * 0.7f))
        drawRect(c, Offset(size.width * 0.56f, size.height * 0.15f), androidx.compose.ui.geometry.Size(w, size.height * 0.7f))
    }
}

/** Top scrim under floating headers, like the iOS grid. */
fun Modifier.topScrim() = this.background(
    Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.75f), Color.Black.copy(alpha = 0.35f), Color.Transparent)),
)

fun Modifier.bottomScrim() = this.background(
    Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.35f), Color.Black.copy(alpha = 0.8f))),
)
