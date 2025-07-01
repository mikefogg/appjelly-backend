import { Model } from "objection";
import { isArray } from "lodash-es";

class BaseModel extends Model {
  static getBasePaginationQuery(query, pagination = {}, options = {}) {
    const sortDirection = pagination?.sort?.direction
      ? pagination.sort.direction
      : options.defaultSortDirection || "desc";
    const pageSize = Math.min(Number(pagination?.per_page || "50"), 50);

    if (pagination.before) {
      const operator = sortDirection === "desc" ? ">" : "<";
      const field =
        pagination?.sort?.field ||
        (isArray(options.sort) ? options.sort[0] : "created_at");
      const fullField = (options.sortPrefix || "") + field;
      query = query.where(fullField, operator, pagination.before);
    }

    if (pagination?.sort?.field) {
      query = query
        .whereNotNull((options.sortPrefix || "") + pagination.sort.field)
        .orderBy(
          (options.sortPrefix || "") + pagination.sort.field,
          sortDirection,
          "last"
        );
    } else {
      query = query.orderBy(
        (options.sortPrefix || "") + "created_at",
        sortDirection,
        "last"
      );
    }

    return query.limit(pageSize);
  }

  $beforeInsert() {
    this.created_at = this.created_at || new Date().toISOString();
  }

  $beforeUpdate() {
    this.updated_at = new Date().toISOString();
  }

  static get jsonSchema() {
    return {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
      },
    };
  }
}

export default BaseModel;