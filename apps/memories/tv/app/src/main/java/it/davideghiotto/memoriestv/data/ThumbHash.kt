package it.davideghiotto.memoriestv.data

import android.graphics.Bitmap
import android.util.Base64
import android.util.LruCache
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * ThumbHash decoder (https://github.com/evanw/thumbhash, public domain), the placeholder Immich
 * sends with every asset. A ~32 px blur shown until the thumbnail arrives, like the iOS grid.
 */
object ThumbHash {
    private val cache = LruCache<String, Bitmap>(3000)

    fun bitmap(base64: String?): Bitmap? {
        if (base64.isNullOrEmpty()) return null
        cache.get(base64)?.let { return it }
        val bmp = runCatching { decode(Base64.decode(base64, Base64.DEFAULT)) }.getOrNull() ?: return null
        cache.put(base64, bmp)
        return bmp
    }

    class Image(val w: Int, val h: Int, val rgba: ByteArray)

    fun decode(hash: ByteArray): Bitmap {
        val img = toRGBA(hash)
        val pixels = IntArray(img.w * img.h) { i ->
            val r = img.rgba[i * 4].toInt() and 255
            val g = img.rgba[i * 4 + 1].toInt() and 255
            val b = img.rgba[i * 4 + 2].toInt() and 255
            val a = img.rgba[i * 4 + 3].toInt() and 255
            (a shl 24) or (r shl 16) or (g shl 8) or b
        }
        return Bitmap.createBitmap(pixels, img.w, img.h, Bitmap.Config.ARGB_8888)
    }

    fun toRGBA(hash: ByteArray): Image {
        fun u(i: Int) = hash[i].toInt() and 255
        val header24 = u(0) or (u(1) shl 8) or (u(2) shl 16)
        val header16 = u(3) or (u(4) shl 8)
        val lDc = (header24 and 63) / 63.0
        val pDc = ((header24 shr 6) and 63) / 31.5 - 1
        val qDc = ((header24 shr 12) and 63) / 31.5 - 1
        val lScale = ((header24 shr 18) and 31) / 31.0
        val hasAlpha = (header24 shr 23) != 0
        val pScale = ((header16 shr 3) and 63) / 63.0
        val qScale = ((header16 shr 9) and 63) / 63.0
        val isLandscape = (header16 shr 15) != 0
        val lx = max(3, if (isLandscape) (if (hasAlpha) 5 else 7) else header16 and 7)
        val ly = max(3, if (isLandscape) header16 and 7 else (if (hasAlpha) 5 else 7))
        val aDc = if (hasAlpha) (u(5) and 15) / 15.0 else 1.0
        val aScale = (u(5) shr 4) / 15.0

        val acStart = if (hasAlpha) 6 else 5
        var acIndex = 0
        fun channel(nx: Int, ny: Int, scale: Double): DoubleArray {
            val ac = ArrayList<Double>()
            for (cy in 0 until ny) {
                var cx = if (cy > 0) 0 else 1
                while (cx * ny < nx * (ny - cy)) {
                    val v = ((u(acStart + (acIndex shr 1)) shr ((acIndex and 1) shl 2)) and 15) / 7.5 - 1
                    ac.add(v * scale)
                    acIndex++
                    cx++
                }
            }
            return ac.toDoubleArray()
        }
        val lAc = channel(lx, ly, lScale)
        val pAc = channel(3, 3, pScale * 1.25)
        val qAc = channel(3, 3, qScale * 1.25)
        val aAc = if (hasAlpha) channel(5, 5, aScale) else DoubleArray(0)

        val ratio = aspectRatio(hash)
        val w = (if (ratio > 1) 32.0 else 32.0 * ratio).roundToInt()
        val h = (if (ratio > 1) 32.0 / ratio else 32.0).roundToInt()
        val rgba = ByteArray(w * h * 4)
        val fx = DoubleArray(7)
        val fy = DoubleArray(7)
        var i = 0
        for (y in 0 until h) {
            for (x in 0 until w) {
                var l = lDc
                var p = pDc
                var q = qDc
                var a = aDc
                for (cx in 0 until max(lx, if (hasAlpha) 5 else 3)) fx[cx] = cos(PI / w * (x + 0.5) * cx)
                for (cy in 0 until max(ly, if (hasAlpha) 5 else 3)) fy[cy] = cos(PI / h * (y + 0.5) * cy)

                var j = 0
                for (cy in 0 until ly) {
                    var cx = if (cy > 0) 0 else 1
                    val fy2 = fy[cy] * 2
                    while (cx * ly < lx * (ly - cy)) { l += lAc[j] * fx[cx] * fy2; cx++; j++ }
                }
                j = 0
                for (cy in 0 until 3) {
                    var cx = if (cy > 0) 0 else 1
                    val fy2 = fy[cy] * 2
                    while (cx < 3 - cy) {
                        val f = fx[cx] * fy2
                        p += pAc[j] * f
                        q += qAc[j] * f
                        cx++; j++
                    }
                }
                if (hasAlpha) {
                    j = 0
                    for (cy in 0 until 5) {
                        var cx = if (cy > 0) 0 else 1
                        val fy2 = fy[cy] * 2
                        while (cx < 5 - cy) { a += aAc[j] * fx[cx] * fy2; cx++; j++ }
                    }
                }
                val b = l - 2.0 / 3.0 * p
                val r = (3 * l - b + q) / 2
                val g = r - q
                rgba[i] = (max(0.0, 255 * min(1.0, r))).toInt().toByte()
                rgba[i + 1] = (max(0.0, 255 * min(1.0, g))).toInt().toByte()
                rgba[i + 2] = (max(0.0, 255 * min(1.0, b))).toInt().toByte()
                rgba[i + 3] = (max(0.0, 255 * min(1.0, a))).toInt().toByte()
                i += 4
            }
        }
        return Image(w, h, rgba)
    }

    private fun aspectRatio(hash: ByteArray): Double {
        val header = hash[3].toInt() and 255
        val hasAlpha = (hash[2].toInt() and 0x80) != 0
        val isLandscape = (hash[4].toInt() and 0x80) != 0
        val lx = if (isLandscape) (if (hasAlpha) 5 else 7) else header and 7
        val ly = if (isLandscape) header and 7 else (if (hasAlpha) 5 else 7)
        return lx.toDouble() / ly
    }
}
