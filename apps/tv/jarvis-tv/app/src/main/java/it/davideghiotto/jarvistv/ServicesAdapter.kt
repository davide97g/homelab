package it.davideghiotto.jarvistv

import android.graphics.Rect
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import it.davideghiotto.jarvistv.databinding.ItemServiceBinding

/** The TCP probes, three to a row, filling whatever height the screen has left. */
class ServicesAdapter : RecyclerView.Adapter<ServicesAdapter.VH>() {

    class VH(val ui: ItemServiceBinding) : RecyclerView.ViewHolder(ui.root)

    var items: List<Service> = emptyList()
        set(value) { field = value; notifyDataSetChanged() }

    /** Set by the screen once it knows how tall a row may be. */
    var rowHeight = 0
        set(value) { if (field != value) { field = value; notifyDataSetChanged() } }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemServiceBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val s = items[position]
        val ui = holder.ui
        if (rowHeight > 0) ui.root.layoutParams.height = rowHeight
        ui.serviceName.text = s.name
        ui.serviceMeta.text = if (s.up) ":${s.port} · ${s.ms} ms"
        else ":${s.port} · ${ui.root.context.getString(R.string.service_down)}"
        val colour = ContextCompat.getColor(ui.root.context, if (s.up) R.color.ok else R.color.err)
        // mutate() first: every dot inflates from the same drawable and so shares one
        // ConstantState, and tinting without it recolours all of them at once.
        ui.serviceDot.background.mutate().setTint(colour)
        ui.serviceName.setTextColor(
            ContextCompat.getColor(ui.root.context, if (s.up) R.color.text_primary else R.color.err)
        )
    }

    override fun getItemCount() = items.size

    /** Even gaps between the three columns without baking margins into the item. */
    class Gaps(private val gap: Int, private val columns: Int) : RecyclerView.ItemDecoration() {
        override fun getItemOffsets(out: Rect, view: View, parent: RecyclerView, state: RecyclerView.State) {
            val i = parent.getChildAdapterPosition(view)
            if (i < 0) return
            val column = i % columns
            out.left = column * gap / columns
            out.right = gap - (column + 1) * gap / columns
            if (i >= columns) out.top = gap
        }
    }
}
