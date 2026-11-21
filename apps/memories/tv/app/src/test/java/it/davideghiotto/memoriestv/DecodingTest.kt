package it.davideghiotto.memoriestv

import it.davideghiotto.memoriestv.data.ThumbHash
import it.davideghiotto.memoriestv.net.AssetDto
import it.davideghiotto.memoriestv.net.BucketAssetsDto
import it.davideghiotto.memoriestv.net.BucketDto
import it.davideghiotto.memoriestv.net.JsonFormat
import it.davideghiotto.memoriestv.net.MemoryDto
import it.davideghiotto.memoriestv.net.SearchDto
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Payloads shaped like Immich v3.4.0 (the same fixtures as the iOS DTODecodingTests). */
class DecodingTest {
    private val assetJson = """
    {"id":"x","type":"VIDEO","originalFileName":"IMG_1.MOV","originalMimeType":"video/quicktime","originalPath":"/p",
     "fileCreatedAt":"2023-08-01T10:00:00.000Z","fileModifiedAt":"2023-08-01T10:00:00.000Z","localDateTime":"2023-08-01T12:00:00.000Z",
     "createdAt":"2023-08-01T10:00:00.000Z","updatedAt":"2023-08-01T10:00:00.000Z","ownerId":"o","checksum":"abc=",
     "isFavorite":true,"isTrashed":false,"isArchived":false,"isOffline":false,"isEdited":false,"hasMetadata":true,"visibility":"timeline",
     "thumbhash":null,"duration":61000,"width":1920,"height":1080,"livePhotoVideoId":null,
     "exifInfo":{"city":"Camogli","country":"Italy","make":"Apple","model":"iPhone","fNumber":1.8,"iso":100,"exifImageWidth":1920,"exifImageHeight":1080,"latitude":44.3,"longitude":9.1},
     "people":[{"id":"p","name":"Giulia","birthDate":null,"isHidden":false,"thumbnailPath":"/t","otherPeople":[],"sharedBy":[],"sharedWith":[]}]}
    """

    @Test fun columnarBucket() {
        val json = """
        {"id":["a","b"],"ownerId":["o","o"],"ratio":[1.3333,0.75],"thumbhash":["HAkOHZxwd3dweHiIiHiHeHRwCPd4",null],
         "fileCreatedAt":["2024-05-12T16:42:00.000Z","2024-05-13T08:00:00.000Z"],"createdAt":["2024-05-12T16:42:00.000Z","2024-05-13T08:00:00.000Z"],
         "localOffsetHours":[2,-5.5],"isImage":[true,false],"duration":[null,12500],"isFavorite":[false,true],"isTrashed":[false,false],
         "livePhotoVideoId":["v1",null],"city":["Milan",null],"country":["Italy",null],"latitude":[45.46,null],"longitude":[9.19,null],
         "projectionType":[null,null],"stack":[null,["s1","3"]],"visibility":["timeline","timeline"]}
        """
        val rows = JsonFormat.decodeFromString<BucketAssetsDto>(json).rows()
        assertEquals(2, rows.size)
        assertTrue(rows[0].isLivePhoto)
        assertEquals("Milan, Italy", rows[0].place)
        assertTrue(rows[1].isVideo)
        assertEquals("0:13", rows[1].durationText)
        assertEquals(18, rows[0].local.hour)
        assertEquals(-5.5, rows[1].offsetHours, 0.0)
    }

    @Test fun bucketWithoutOptionalColumns() {
        val json = """
        {"id":["a"],"ownerId":["o"],"ratio":[1],"thumbhash":[null],"fileCreatedAt":["2024-05-12T16:42:00Z"],"createdAt":["2024-05-12T16:42:00Z"],
         "localOffsetHours":[0],"isImage":[true],"duration":[null],"isFavorite":[false],"isTrashed":[false],"livePhotoVideoId":[null],
         "projectionType":[null],"visibility":["timeline"]}
        """
        val row = JsonFormat.decodeFromString<BucketAssetsDto>(json).rows().single()
        assertNull(row.city)
        assertEquals(2024, row.local.year)
    }

    @Test fun buckets() {
        val b = JsonFormat.decodeFromString<List<BucketDto>>("""[{"timeBucket":"2024-05-01","count":42}]""")
        assertEquals(42, b.single().count)
    }

    @Test fun asset() {
        val a = JsonFormat.decodeFromString<AssetDto>(assetJson)
        val asset = a.asset()
        assertTrue(asset.isVideo)
        assertEquals("1:01", asset.durationText)
        assertEquals(16f / 9f, asset.ratio, 0.001f)
        assertEquals(2.0, asset.offsetHours, 0.0)
        assertEquals("Giulia", a.people?.single()?.name)
    }

    @Test fun searchAndMemories() {
        val res = JsonFormat.decodeFromString<SearchDto>(
            """{"albums":{"count":0,"total":0,"items":[],"facets":[]},"assets":{"count":1,"total":1,"items":[$assetJson],"facets":[],"nextPage":"2","nextCursor":null}}""")
        assertEquals("2", res.assets.nextPage)
        val m = JsonFormat.decodeFromString<List<MemoryDto>>(
            """[{"id":"m","type":"on_this_day","data":{"year":2021},"assets":[$assetJson],"memoryAt":"2021-11-10T00:00:00.000Z","isSaved":false}]""")
        assertEquals(2021, m.single().data.year)
    }

    /** Reference values from npm thumbhash 0.1.1 (same as the iOS ThumbHashTests). */
    @Test fun thumbHashMatchesReference() {
        val land = ThumbHash.toRGBA(Base64.getDecoder().decode("HAkOHZxwd3dweHiIiHiHeHRwCPd4"))
        assertEquals(32, land.w)
        assertEquals(23, land.h)
        assertEquals(436_703, land.rgba.sumOf { it.toInt() and 255 })
        val portrait = ThumbHash.toRGBA(Base64.getDecoder().decode("HQkOIxyBcIiHh4iHgIgI+Hg="))
        assertEquals(14, portrait.w)
        assertEquals(32, portrait.h)
        assertEquals(270_262, portrait.rgba.sumOf { it.toInt() and 255 })
    }
}
